## Summary

Brief description of the change. If it touches pricing, explain which provider,
service and SKU/part, and how the new number was verified.

## Pricing impact

- [ ] No pricing logic changed
- [ ] Pricing changed — verified against the provider's official pricing page for the region (state how in the PR)
- [ ] Any fallback/assumption introduced is labeled (`source` + warning) — silent fallbacks are rejected

## Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] `npm run smoke` passes (help + regions on the built CLI)
- [ ] Documentation updated if flags/commands/output changed
