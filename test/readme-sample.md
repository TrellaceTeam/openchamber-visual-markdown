# awesome-tool

[![Build](https://img.shields.io/badge/build-passing-green)](https://example.com/ci) [![License: MIT](https://img.shields.io/badge/license-MIT-black)](LICENSE) ![](https://example.com/untitled.png)

> A small tool that does one thing well.

![Architecture](docs/architecture.svg)

![Screenshot of the dashboard](docs/screenshot.png)

## Install

```bash
npm install awesome-tool
```

## Charts

```mermaid
pie title Where the time goes
    "Reading" : 45
    "Writing" : 30
    "Reviewing" : 15
    "Meetings" : 10
```

```mermaid
sequenceDiagram
    participant U as User
    participant A as Agent
    U->>A: Fix the failing test
    activate A
    A-->>U: Here is a plan
    Note over U,A: The plan is a Markdown file
    U->>A: Looks good, go
    deactivate A
```

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Review: submit
    Review --> Draft: changes asked
    Review --> Done: approved
    Done --> [*]
```

## Changes

```diff
- const limit = 10;
+ const limit = 100;
```

```python
def greet(name: str) -> str:
    """Say hello."""
    return f"Hello, {name}!"  # a comment
```

| Option | Type | Default |
|--------|------|---------|
| `fast` | boolean | `false` |
| `out` | string | `"dist"` |

See the [guide](docs/guide.md) or the [site](https://example.com).
