"""Score an exported DocuMind run with the official RAGAS library (cross-check for the built-in metrics).

    pip install -r scripts/requirements-eval.txt
    GOOGLE_API_KEY=<gemini key> python scripts/ragas_eval.py run.jsonl

Uses LangChain's Gemini integration as the judge LLM and embedding model.
"""
import json
import sys

from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from ragas import EvaluationDataset, evaluate
from ragas.embeddings import LangchainEmbeddingsWrapper
from ragas.llms import LangchainLLMWrapper
from ragas.metrics import Faithfulness, LLMContextPrecisionWithReference, LLMContextRecall, ResponseRelevancy

rows = [json.loads(line) for line in open(sys.argv[1]) if line.strip()]
answerable = [r for r in rows if r["retrieved_contexts"]]
llm = LangchainLLMWrapper(ChatGoogleGenerativeAI(model="gemini-flash-lite-latest", temperature=0))
emb = LangchainEmbeddingsWrapper(GoogleGenerativeAIEmbeddings(model="models/gemini-embedding-001"))

metrics = [Faithfulness(), ResponseRelevancy()]
if all(r["reference"] for r in answerable):
    metrics += [LLMContextPrecisionWithReference(), LLMContextRecall()]

result = evaluate(EvaluationDataset.from_list(answerable), metrics=metrics, llm=llm, embeddings=emb)
print(result)
result.to_pandas().to_csv("ragas_results.csv", index=False)
print("per-question scores written to ragas_results.csv")
