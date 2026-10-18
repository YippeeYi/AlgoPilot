#!/usr/bin/env python3
"""Developer-only fixed-fixture verifier. No production import/API or model calls.
Only the two expressly authorized source paths+hashes can be compiled. Missing
fixtures/sandbox/resources fail closed, never fall back to unconfined execution.
"""
import argparse
from collections import Counter
import errno
import hashlib
import itertools
import json
import os
from pathlib import Path
import resource
import signal
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = {
    'ac': ('615b_ac_user_supplied_dfs.cpp', '28c1536662ec4497cc94afe96b3888a5a6ff240f76eb1b380a523dbf9530a91b'),
    'wa': ('615b_wa_user_supplied.cpp', 'b66ccdbe1e2804e6013eba55ba801d90398876dd5f3c31c3a373108b02aced63'),
}
PROFILE = '(version 1)(allow default)(deny network*)'
RUNTIME_PROFILE = PROFILE+'(deny process-fork)'


def parse_graph(text):
    if not isinstance(text, str) or len(text) > 64000:
        raise ValueError('input_size')
    tokens = text.split()
    if len(tokens) < 2 or any(not t.isascii() or not t.isdecimal() or len(t)>6 for t in tokens):
        raise ValueError('input_format')
    values = list(map(int, tokens)); n, m = values[:2]
    if not 2 <= n <= 100000 or not 1 <= m <= 200000 or len(values) != 2+2*m:
        raise ValueError('input_constraints')
    edges = list(zip(values[2::2], values[3::2])); seen = set()
    for u, v in edges:
        key = tuple(sorted((u, v)))
        if not 1 <= u <= n or not 1 <= v <= n or u == v or key in seen:
            raise ValueError('invalid_edge')
        seen.add(key)
    return n, edges


def oracle(n, edges):
    # Enumerates complete strictly increasing paths, not the submitted DP recurrence.
    if n > 8:
        raise OverflowError('oracle_bound')
    adjacent = [[] for _ in range(n+1)]
    for u, v in edges:
        adjacent[u].append(v); adjacent[v].append(u)
    def paths(v, length):
        return max([length*len(adjacent[v])] + [paths(w, length+1) for w in adjacent[v] if w>v])
    return max(paths(v, 1) for v in range(1, n+1))


def classify(correct, ac, wa, claimed_correct=None, claimed_wa=None):
    if ac != correct:
        return {'classification':'unable_to_verify', 'reason':'ac_fixture_disagrees_with_oracle'}
    mismatches = []
    if claimed_correct is not None and claimed_correct != correct: mismatches.append('claimed_correct')
    if claimed_wa is not None and claimed_wa != wa: mismatches.append('claimed_wa')
    behavior = 'triggered_wa' if wa != correct else 'not_triggered_wa'
    return {'classification':'model_execution_result_incorrect' if mismatches else behavior,
            'behavior':behavior,'claimMismatches':mismatches,'oracle':correct,'ac':ac,'wa':wa}


def limits(compiling=False):
    resource.setrlimit(resource.RLIMIT_CPU, (15,15) if compiling else (2,2))
    # Darwin rejects RLIMIT_AS/DATA here; bounded() enforces an RSS watchdog.
    resource.setrlimit(resource.RLIMIT_CORE, (0,0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (16*1024*1024,16*1024*1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64,64))
    resource.setrlimit(resource.RLIMIT_NPROC, (1024,1024) if compiling else (0,0))


def bounded(command, data=None, compiling=False, memory_mib=None):
    proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            start_new_session=True, preexec_fn=lambda: limits(compiling))
    deadline=time.monotonic()+(30 if compiling else 3)
    first=True
    cap=(memory_mib or (1024 if compiling else 256))*1024
    try:
        while True:
            if time.monotonic()>deadline: raise RuntimeError('timeout')
            # Only this known child PID's numeric RSS; no args/environment/other users.
            if proc.poll() is None:
                memory=subprocess.run(['/bin/ps','-o','rss=','-p',str(proc.pid)],capture_output=True,timeout=1)
                if memory.returncode==0:
                    if int(memory.stdout.strip())>cap: raise RuntimeError('memory_limit')
                elif proc.poll() is None: raise RuntimeError('memory_monitor_unavailable')
            try:
                stdout,stderr=proc.communicate(data if first else None,timeout=0.01)
                break
            except subprocess.TimeoutExpired:
                first=False
    except (RuntimeError,subprocess.SubprocessError,ValueError):
        if proc.poll() is None: os.killpg(proc.pid,signal.SIGKILL)
        proc.communicate()
        raise
    # Never return compiler diagnostics (they may quote private source).
    if proc.returncode != 0: raise RuntimeError('compile_failed' if compiling else 'runtime_failed')
    if len(stdout)>4096 or len(stderr)>4096: raise RuntimeError('output_bound')
    return stdout.decode('ascii').strip()


class FixedVerifier:
    def __init__(self):
        if sys.platform != 'darwin' or not Path('/usr/bin/sandbox-exec').is_file():
            raise RuntimeError('sandbox_unavailable')
        self.directory = tempfile.TemporaryDirectory(prefix='algopilot-m352-private-')
        self.root = Path(self.directory.name); os.chmod(self.root,0o700)
        (self.root/'bits').mkdir()
        (self.root/'bits/stdc++.h').write_text('#include <algorithm>\n#include <cstdio>\n#include <vector>\n#include <cstring>\n#include <iostream>\n')
        self.executables = {}
        for kind, (filename, digest) in FIXTURES.items():
            path = ROOT/'tests/fixtures/reviews'/filename
            if not path.exists(): raise RuntimeError('fixed_fixture_missing')
            data = path.read_bytes()
            if hashlib.sha256(data).hexdigest()!=digest: raise RuntimeError('fixed_fixture_hash_mismatch')
            copy = self.root/(kind+'.cpp'); copy.write_bytes(data); os.chmod(copy,0o600)
            self.executables[kind] = self.compile(copy,kind)
        self.metadata={}
        for kind in FIXTURES:
            wrapper=self.root/(kind+'-metadata.cpp')
            wrapper.write_text('#define main fixture_main\n#include "'+kind+'.cpp"\n#undef main\nint main(){printf("%zu %zu %zu",sizeof(e)/sizeof(e[0]),sizeof(l[0]),sizeof(d[0]));}\n')
            executable=self.compile(wrapper,kind+'-metadata')
            values=list(map(int,bounded(['/usr/bin/sandbox-exec','-p',RUNTIME_PROFILE,str(executable)]).split()))
            self.metadata[kind]={'edgeArrayElements':values[0],'pathElementBytes':values[1],'degreeElementBytes':values[2],
                                 'requiredOneBasedElementsAtMaxM':400001,'capacitySufficient':values[0]>=400001}
        # Fixed trusted probe: only loopback socket and fork attempts, both must fail.
        probe=self.root/'probe.cpp'
        probe.write_text('''#include <sys/socket.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <netinet/in.h>
#include <unistd.h>
#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
int main(){if(getchar()=='m'){char *m=(char*)malloc(64*1024*1024);for(int i=0;i<64*1024*1024;i++)((volatile char*)m)[i]=1;while(true)pause();}
struct rlimit p;getrlimit(RLIMIT_NPROC,&p);
int fd=socket(AF_INET,SOCK_STREAM,0),net=errno;
if(fd>=0){sockaddr_in s{};s.sin_family=AF_INET;s.sin_port=htons(9);s.sin_addr.s_addr=htonl(INADDR_LOOPBACK);int r=connect(fd,(sockaddr*)&s,sizeof(s));net=r<0?errno:0;close(fd);}
pid_t child=fork();int f=errno;if(child==0)_exit(2);if(child>0){int status;waitpid(child,&status,0);return 3;}
printf("%d %d %llu",net,f,(unsigned long long)p.rlim_cur);}
''');os.chmod(probe,0o600)
        exe=self.compile(probe,'probe')
        values=list(map(int,bounded(['/usr/bin/sandbox-exec','-p',RUNTIME_PROFILE,str(exe)]).split()))
        if len(values)!=3 or values[0] not in [errno.EPERM,errno.EACCES] or values[1] not in [errno.EPERM,errno.EAGAIN] or values[2]!=0:
            raise RuntimeError('isolation_probe_failed')
        try:
            bounded(['/usr/bin/sandbox-exec','-p',RUNTIME_PROFILE,str(exe)],b'm',memory_mib=8)
            raise RuntimeError('memory_probe_failed')
        except RuntimeError as error:
            if str(error)!='memory_limit': raise
        self.probe={'networkDenied':True,'forkDenied':True,'memoryMechanism':'Parent RSS watchdog; sampled, not a hard address-space guarantee', 'runtimeRssMiB':256,'memoryProbeKilledAtMiB':8,'processLimit':0,'runtimeCpuSeconds':2,'wallSeconds':3}

    def compile(self, source, name):
        exe=self.root/name
        bounded(['/usr/bin/sandbox-exec','-p',PROFILE,'/usr/bin/clang++','-std=c++17','-O2','-I',str(self.root),str(source),'-o',str(exe)],compiling=True)
        return exe

    def check(self, case):
        try: n,edges=parse_graph(case.get('input'))
        except ValueError as error: return {'classification':'invalid_input','reason':str(error)}
        try: correct=oracle(n,edges)
        except OverflowError: return {'classification':'unable_to_verify','reason':'oracle_bound'}
        for key in ['claimedCorrect','claimedWa']:
            value=case.get(key)
            if value is not None and (type(value) is not int or not 0<=value<=100000*99999):
                return {'classification':'invalid_input','reason':'claim_format'}
        try:
            outputs={kind:int(bounded(['/usr/bin/sandbox-exec','-p',RUNTIME_PROFILE,str(exe)],case['input'].encode())) for kind,exe in self.executables.items()}
        except RuntimeError as error:
            allowed={'timeout','memory_limit','runtime_failed','memory_monitor_unavailable','output_bound'}
            return {'classification':'unable_to_verify','reason':str(error) if str(error) in allowed else 'execution_failed'}
        except ValueError: return {'classification':'unable_to_verify','reason':'non_integer_output'}
        return classify(correct,outputs['ac'],outputs['wa'],case.get('claimedCorrect'),case.get('claimedWa'))

    def close(self): self.directory.cleanup()


def main():
    args=argparse.ArgumentParser();args.add_argument('--cases',type=Path,default=ROOT/'tests/fixtures/reviews/615b-cases.json');args.add_argument('--output',type=Path,default=Path('/tmp/algopilot-m352-counterexamples.json'));a=args.parse_args()
    report={'boundary':'Offline user-supplied normalized complete DFS fixtures; not CF source identity, production execution or a new Provider quality run', 'fixtureSha256':{k:v[1]for k,v in FIXTURES.items()},'providerCalls':0}
    verifier=None
    try:
        if a.cases.stat().st_size>64000: raise RuntimeError('cases_size')
        cases=json.loads(a.cases.read_text())
        if not isinstance(cases,list) or not 1<=len(cases)<=50 or any(not isinstance(c,dict) for c in cases): raise RuntimeError('cases_format')
        verifier=FixedVerifier();report['isolation']=verifier.probe;report['compiledMetadata']=verifier.metadata
        print('Fixed source hashes and network/process/resource probe: PASS',flush=True)
        report['cases']=[{'id':c.get('id'),'source':c.get('source'),**verifier.check(c)}for c in cases]
        # Order matters: all permutations of the supplied five-edge control.
        n,edges=parse_graph('4 5\n1 4\n1 3\n2 3\n2 4\n3 4\n');hist=Counter()
        for permutation in itertools.permutations(edges):
            text=f'{n} 5\n'+''.join(f'{u} {v}\n'for u,v in permutation)
            r=verifier.check({'input':text})
            if r['classification']=='unable_to_verify': raise RuntimeError('order_verification_failed')
            hist[str(r['wa'])]+=1
        report['edgeOrderControl']={'permutations':sum(hist.values()),'waOutputHistogram':dict(sorted(hist.items())),'acAndOracleAlways':9}
        print('Five-edge control permutations: PASS',flush=True)
        total=0;wa_disagreements=0
        for n in range(2,5):
            possible=list(itertools.combinations(range(1,n+1),2))
            for mask in range(1,1<<len(possible)):
                edges=[e for i,e in enumerate(possible)if mask&(1<<i)]
                for order in [edges,edges[::-1]]:
                    text=f'{n} {len(order)}\n'+''.join(f'{u} {v}\n'for u,v in order)
                    r=verifier.check({'input':text});total+=1
                    if r['classification']=='unable_to_verify': raise RuntimeError('oracle_comparison_failed')
                    wa_disagreements+=r['behavior']=='triggered_wa'
        report['exhaustiveSmallGraphs']={'cases':total,'acMatchesOracle':total,'waDisagreements':wa_disagreements}
        report['status']='unable_to_verify' if any(c['classification']=='unable_to_verify' for c in report['cases']) else 'PASS'
    except (RuntimeError,OSError,ValueError,subprocess.SubprocessError) as error:
        report['status']='unable_to_verify'
        report['reason']=str(error) if isinstance(error,RuntimeError) else 'fixture_io_or_sandbox_failure'
    finally:
        if verifier: verifier.close()
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'status':report['status'],'report':str(a.output)}))
    return 0 if report['status']=='PASS' else 2

if __name__=='__main__': sys.exit(main())
