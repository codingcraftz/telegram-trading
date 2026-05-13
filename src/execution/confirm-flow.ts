import { getConfig } from '../config.js';
import { logTrade, insertPendingIntent, type OrderSpec } from '../db/repo.js';
import { runAgent, type ProposalArgs } from '../llm/claude.js';
import { checkSpec } from '../guardrails/policy.js';

export type FlowResult =
  | { kind: 'reply'; text: string }
  | { kind: 'proposal_saved'; intentId: string; summary: string };

export async function processUserMessage(args: {
  chatId: number;
  text: string;
}): Promise<FlowResult> {
  const cfg = getConfig();
  const out = await runAgent(args.text);

  if (out.kind === 'text') {
    return { kind: 'reply', text: out.text };
  }

  const p: ProposalArgs = out.proposal;
  const spec: OrderSpec = {
    action: p.action,
    market: p.market,
    symbol_code: p.symbol_code,
    symbol_name: p.symbol_name,
    order_type: p.order_type,
    price: p.price,
    quantity: p.quantity,
    tp_pct: p.tp_pct ?? null,
    sl_pct: p.sl_pct ?? null,
  };

  const guard = checkSpec(spec);
  if (!guard.ok) {
    return { kind: 'reply', text: `❌ 거절: ${guard.reason}` };
  }

  const intentId = insertPendingIntent({
    chatId: args.chatId,
    llmProposal: p.summary_message,
    orderSpec: spec,
    ttlMin: cfg.INTENT_TTL_MIN,
  });
  logTrade({ chatId: args.chatId, kind: 'proposed', payload: { intentId, spec } });

  const summary = p.summary_message.replaceAll('<id>', intentId);
  return { kind: 'proposal_saved', intentId, summary };
}
