"""Pure oracle/input/claim contracts; not a model-quality or native-execution test."""
import importlib.util
from pathlib import Path
import unittest

path=Path(__file__).resolve().parents[2]/'scripts/m352-verify-counterexamples.py'
spec=importlib.util.spec_from_file_location('m352',path)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class CounterexampleContracts(unittest.TestCase):
    def test_constraints(self):
        for text in ['', '3 1\n1 1\n', '3 2\n1 2\n2 1\n', '3 1\n1 4\n', '3 2\n1 2\n', '2 0\n', '100001 1\n1 2\n', '3 1\n1 2\n99', '3 1\n1 x\n']:
            with self.subTest(text=text):
                self.assertRaises(ValueError,m.parse_graph,text)
    def test_independent_path_oracle(self):
        for text,expected in [('3 2\n1 3\n2 3\n',4),('4 3\n1 4\n2 3\n3 4\n',6),('4 5\n1 4\n1 3\n2 3\n2 4\n3 4\n',9)]:
            n,e=m.parse_graph(text);self.assertEqual(m.oracle(n,e),expected)
    def test_all_result_categories_remain_distinct(self):
        self.assertEqual(m.classify(9,9,6,9,6)['classification'],'triggered_wa')
        self.assertEqual(m.classify(4,4,4,4,4)['classification'],'not_triggered_wa')
        result=m.classify(6,6,6,6,4)
        self.assertEqual(result['classification'],'model_execution_result_incorrect')
        self.assertEqual(result['behavior'],'not_triggered_wa')
        self.assertEqual(result['claimMismatches'],['claimed_wa'])
        self.assertEqual(m.classify(9,8,6)['classification'],'unable_to_verify')
        verifier=object.__new__(m.FixedVerifier)
        self.assertEqual(verifier.check({'input':'2 0'})['classification'],'invalid_input')
        self.assertEqual(verifier.check({'input':'9 1\n1 2\n'})['classification'],'unable_to_verify')
    def test_direction_change_requires_matching_update_and_undirected_degree(self):
        import itertools
        for n in range(2,5):
            possible=list(itertools.combinations(range(1,n+1),2))
            for mask in range(1,1<<len(possible)):
                edges=[e for i,e in enumerate(possible)if mask&(1<<i)]
                degree=[0]*(n+1);incoming=[[]for _ in degree];outgoing=[[]for _ in degree]
                for u,v in edges:
                    degree[u]+=1;degree[v]+=1;incoming[v].append(u);outgoing[u].append(v)
                pull=[0]*(n+1);push=[0]*(n+1)
                for v in range(1,n+1):
                    pull[v]=max([0]+[pull[u]+1 for u in incoming[v]])
                    for w in outgoing[v]:push[w]=max(push[w],push[v]+1)
                expected=m.oracle(n,edges)
                self.assertEqual(max((pull[i]+1)*degree[i]for i in range(1,n+1)),expected)
                self.assertEqual(max((push[i]+1)*degree[i]for i in range(1,n+1)),expected)
    def test_integer_claims_not_boolean_or_strings(self):
        verifier=object.__new__(m.FixedVerifier)
        for value in [True,'4',-1,10000000000]:
            self.assertEqual(verifier.check({'input':'3 2\n1 3\n2 3\n','claimedWa':value})['reason'],'claim_format')

if __name__=='__main__': unittest.main()
