# Plan: add rate limiting

**Status:** draft  
**Owner:** agent

## Goal

Limit each API key to 100 requests a minute, so one client can't slow the service for everyone.

## Steps

- [x] Read the current middleware (`src/middleware/auth.ts`)
- [ ] Add a token bucket per key
- [ ] Return `429` with a `Retry-After` header
- [ ] Tests:
  - [ ] under the limit
  - [ ] over the limit
  - [ ] bucket refill

## Design

| Choice | Picked | Why |
| --- | --- | --- |
| Storage | Redis | Shared across instances |
| Algorithm | Token bucket | Allows short bursts |

```ts
export async function limit(key: string): Promise<boolean> {
  const tokens = await redis.decr(`bucket:${key}`);
  return tokens >= 0;
}
```

> [!NOTE]
> The limit is per key, not per IP.

## Open questions

1. Should admin keys be exempt?
2. What happens when Redis is down?
