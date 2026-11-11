-- Record read-only PayPal Agent Toolkit analyses in the existing AI run ledger.
alter table public.ai_analysis_runs drop constraint if exists ai_analysis_runs_agent_check;
alter table public.ai_analysis_runs add constraint ai_analysis_runs_agent_check check (
  agent in (
    'intent_interpreter',
    'demand_matcher',
    'market_gap_researcher',
    'product_architect',
    'commercial_analyst',
    'integrity_analyst',
    'cluster_summarizer',
    'wish_researcher',
    'paypal_operations_copilot',
    'embedding'
  )
);
