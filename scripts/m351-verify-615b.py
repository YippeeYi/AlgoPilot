#!/usr/bin/env python3
"""Offline acceptance, not a product runner/judge. Only trusted supplied fixture.
Usage: python3 scripts/m351-verify-615b.py --request /path/to/request.txt
Extracts the last C++ block (complete iterative version); private copies stay in /tmp.
AC/WA fragments are explicitly reconstructed; oracle enumerates increasing paths.
"""
import argparse
import hashlib
import itertools
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


def adjacency(n, edges):
    adj = [[] for _ in range(n)]
    for u, v in edges:
        adj[u].insert(0, v)
        adj[v].insert(0, u)
    return adj


def model(n, edges, buggy=False):
    adj = adjacency(n, edges)
    dp, visited, trace = [0]*n, [0]*n, []
    def dfs(x):
        if visited[x]:
            return
        visited[x] = 1
        for y in adj[x]:
            if y < x:
                if not buggy or not dp[y]:
                    dfs(y)
                if visited[y] == 1:
                    trace.append({'reader': x+1, 'unfinished': y+1, 'value': dp[y]})
                dp[x] = max(dp[x], dp[y]+1)
        if buggy:
            for y in adj[x]:
                if y > x:
                    dfs(y)
        visited[x] = 2
    for x in range(n):
        dfs(x)
    return max((dp[x]+1)*len(adj[x]) for x in range(n)), dp, trace


def oracle(n, edges):
    # Enumerate whole increasing paths, without memoization or DP recurrence.
    adj = adjacency(n, edges)
    best, terminal = 0, [0]*n
    def walk(x, vertices):
        nonlocal best
        terminal[x] = max(terminal[x], vertices-1)
        best = max(best, vertices*len(adj[x]))
        for y in adj[x]:
            if y > x:
                walk(y, vertices+1)
    for x in range(n):
        walk(x, 1)
    return best, terminal


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--request', required=True)
    parser.add_argument('--output', default='docs/m351/algorithm-verification.json')
    args = parser.parse_args()
    private = Path(tempfile.mkdtemp(prefix='algopilot-m351-private-'))
    os.chmod(private, 0o700)
    source = re.findall(r'```cpp\n(.*?)```', Path(args.request).read_text(), re.S)[-1]
    assert '#include <bits/stdc++.h>' in source and 'int main()' in source
    source_sha256 = hashlib.sha256(source.encode()).hexdigest()
    # Scope execution to the exact fixture authorized for this acceptance task.
    if source_sha256 != '7a0963c3d0b93c687431fd2718bd123b4e8de28332d653cad861acf30976fc22':
        raise SystemExit('Unrecognized fixture; no code executed')
    cpp = private/'iterative.cpp'
    cpp.write_text(source)
    os.chmod(cpp, 0o600)
    # macOS Clang lacks GNU umbrella header; test-only shim changes no source bytes.
    (private/'bits').mkdir()
    (private/'bits/stdc++.h').write_text('#include <algorithm>\n#include <cstdio>\n#include <vector>\n')
    executable = private/'iterative'
    command = ['clang++', '-std=c++17', '-O1', '-g', '-fsanitize=address,undefined',
               '-fno-sanitize-recover=all', '-I', str(private), str(cpp), '-o', str(executable)]
    subprocess.run(command, check=True, capture_output=True, timeout=30)
    def native(n, edges, expected):
        data = f'{n} {len(edges)}\n'+''.join(f'{u+1} {v+1}\n' for u,v in edges)
        result = subprocess.run([str(executable)], input=data, text=True, capture_output=True, timeout=10)
        assert result.returncode == 0, result.stderr
        assert int(result.stdout) == expected, (n, expected, result.stdout)
    count, disagreements, witness = 0, 0, None
    # All valid simple labelled graphs through 5 vertices, both forward-star orders.
    for n in range(2, 6):
        possibilities = list(itertools.combinations(range(n), 2))
        for mask in range(1, 1 << len(possibilities)):
            edges = [e for k,e in enumerate(possibilities) if mask & (1 << k)]
            expected, terminal = oracle(n, edges)
            for ordered in [edges, edges[::-1]]:
                good, dp, _ = model(n, ordered)
                bad, wrong, reads = model(n, ordered, True)
                assert (good, dp) == (expected, terminal)
                count += 1
                if bad != expected:
                    disagreements += 1
                    if witness is None or (n, len(edges)) < (witness['n'], len(witness['edges'])):
                        witness = {'n': n, 'edges': [[u+1,v+1] for u,v in ordered],
                                   'expected': expected, 'wa': bad, 'correctDpEdges': dp,
                                   'waDpEdges': wrong, 'unfinishedReads': reads}
    assert witness and witness['n'] == 5 and len(witness['edges']) == 5
    # Compile independent reconstructions of the two supplied DFS fragments.
    # Surrounding early vis guard, ascending root loop and forward-star order are assumptions.
    reconstructed = """#include <algorithm>
#include <cstdio>
#include <vector>
using namespace std;
vector<int> a[100005]; long long l[100005]; int vis[100005];
void dfs(int x) {
 if(vis[x]) return; vis[x]=1;
 vector<int> next;
 for(int y:a[x]) {
  if(y<x) {
   if(!BUG || !l[y]) dfs(y);
   l[x]=max(l[x],l[y]+1);
  } else next.push_back(y);
 }
 if(BUG) for(int y:next) dfs(y);
}
int main(){int n,m;scanf("%d%d",&n,&m);while(m--){int u,v;scanf("%d%d",&u,&v);a[u].insert(a[u].begin(),v);a[v].insert(a[v].begin(),u);}
long long ans=0;for(int x=1;x<=n;x++){dfs(x);ans=max(ans,(l[x]+1)*(long long)a[x].size());}printf("%lld",ans);}
"""
    witness_input = str(witness['n'])+' '+str(len(witness['edges']))+'\n'+''.join(f'{u} {v}\n' for u,v in witness['edges'])
    for bug, expected in [(False, witness['expected']), (True, witness['wa'])]:
        path = private/f'dfs-reconstruction-{int(bug)}.cpp'
        path.write_text(reconstructed.replace('BUG', 'true' if bug else 'false'))
        os.chmod(path, 0o600)
        exe = private/f'dfs-reconstruction-{int(bug)}'
        compile_command = command.copy(); compile_command[-3:] = [str(path), '-o', str(exe)]
        subprocess.run(compile_command, check=True, capture_output=True, timeout=30)
        result = subprocess.run([str(exe)], input=witness_input, text=True, capture_output=True, timeout=10)
        assert result.returncode == 0 and int(result.stdout) == expected
    # Native cases include every 4-vertex graph and this minimized WA witness.
    native_count = 0
    n = 4
    possible = list(itertools.combinations(range(n), 2))
    for mask in range(1, 1 << len(possible)):
        edges = [e for k,e in enumerate(possible) if mask & (1 << k)]
        native(n, edges, oracle(n, edges)[0]); native_count += 1
    for n, edges, expected in [
        (8, [(3,4),(2,4),(1,4),(0,1),(1,7),(5,6)], 9),
        (4, list(itertools.combinations(range(4),2)), 12),
        (5, [(u-1,v-1) for u,v in witness['edges']], witness['expected']),
        (2, [(0,1)], 2),
        (100000, [(x,x+1) for x in range(99999)], 199998),
        (100000, [(0,x) for x in range(1,100000)], 99999),
        (100000, [(0,1)], 2),
    ]:
        native(n, edges, expected); native_count += 1
    edges = [(x,x+1) for x in range(99999)] + [(x,99999) for x in range(99998)]
    edges += [(0,2),(0,3),(0,4)]
    assert len(edges) == 200000 and len(set(edges)) == 200000
    native(100000, edges, 9999900000); native_count += 1
    # Negative type control: int storage WITHOUT 1LL must be detected by UBSan.
    bad_source = source.replace('long long d[MAXN], l[MAXN], ans;', 'int d[MAXN], l[MAXN]; long long ans;')
    bad_source = bad_source.replace('max(ans, (l[i] + 1) * d[i])', 'max(ans, (long long)((l[i] + 1) * d[i]))')
    assert bad_source != source and '(long long)((l[i] + 1) * d[i])' in bad_source
    bad_cpp = private/'int-negative-control.cpp'; bad_cpp.write_text(bad_source); os.chmod(bad_cpp,0o600)
    bad_exe = private/'int-negative-control'
    negative_command = command.copy(); negative_command[-3:] = [str(bad_cpp), '-o', str(bad_exe)]
    subprocess.run(negative_command, check=True, capture_output=True, timeout=30)
    data = f'100000 {len(edges)}\n'+''.join(f'{u+1} {v+1}\n' for u,v in edges)
    result = subprocess.run([str(bad_exe)], input=data, text=True, capture_output=True, timeout=10)
    assert result.returncode != 0 and 'signed integer overflow' in result.stderr
    # Positive type control: int arrays with promotion BEFORE multiplication.
    fixed_cpp = private/'int-promoted.cpp'
    fixed_cpp.write_text(bad_source.replace('(long long)((l[i] + 1) * d[i])', '1LL * (l[i] + 1) * d[i]'))
    os.chmod(fixed_cpp,0o600)
    fixed_exe = private/'int-promoted'
    fixed_command = command.copy(); fixed_command[-3:] = [str(fixed_cpp), '-o', str(fixed_exe)]
    subprocess.run(fixed_command, check=True, capture_output=True, timeout=30)
    result = subprocess.run([str(fixed_exe)], input=data, text=True, capture_output=True, timeout=10)
    assert result.returncode == 0 and int(result.stdout) == 9999900000
    # Separate, answer-free inputs for a future authorized diagnostic evaluation.
    # No invocation/transport, and these are NOT self-reported-AC production records.
    blind = private/'blind'; blind.mkdir(mode=0o700)
    statement = ("Simple undirected graph: 2<=n<=100000, 1<=m<=200000. "
                 "Choose a strictly increasing vertex path. Maximize number of path vertices "
                 "times original undirected degree of its terminal vertex. "
                 "Statically assess this implementation: define its state, justify or refute "
                 "correctness, give a concrete counterexample if incorrect, discuss complexity, "
                 "numeric evaluation and limits. Do not claim execution or infer personal weaknesses.\n")
    for label, code in [('A', reconstructed.replace('BUG','true')),
                        ('B', source), ('C', reconstructed.replace('BUG','false'))]:
        path = blind/f'{label}.txt'; path.write_text(statement+'\n```cpp\n'+code+'\n```\n'); os.chmod(path,0o600)
    mapping = private/'reviewer-key.json'
    mapping.write_text(json.dumps({'A':'reconstructed historical WA','B':'supplied post-AC unsubmitted iteration',
                                  'C':'reconstructed AC fragment; full original unavailable',
                                  'providerStatus':'NOT_RUN','productReviewStatus':'NOT_RUN'},indent=2)+'\n')
    os.chmod(mapping,0o600)
    report = {'boundary': 'Offline trusted fixture acceptance; not Codeforces judging, product execution, Provider review or exact historical DFS source',
              'completeIterativeSourceSha256': source_sha256,
              'compiler': subprocess.run(['clang++','--version'],capture_output=True,text=True,check=True).stdout.splitlines()[0],
              'flags': '-std=c++17 -O1 -g -fsanitize=address,undefined -fno-sanitize-recover=all',
              'headerCompatibility': 'Test-only bits/stdc++.h shim: algorithm/cstdio/vector; supplied source unchanged',
              'reconstructedDfsVsExhaustivePathCases': count, 'reconstructedWaAnswerDisagreements': disagreements,
              'witness': witness, 'nativeReconstructedDfsCounterexample': {'ac': 9, 'wa': 6}, 'nativeIterativeCases': native_count,
              'maximumBoundary': {'vertices': 100000, 'edges': 200000, 'answer': 9999900000},
              'intProductNegativeControl': 'UBSan signed integer overflow detected',
              'intWithEarlyPromotion': 'PASS', 'providerCalls': 0}
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'report':args.output,'privateSource':str(cpp),'cases':count,'native':native_count,'blindInputs':str(blind)}))

if __name__ == '__main__':
    main()
