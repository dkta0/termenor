# Task Completion

To confirm that a task has been successfully completed and is fully verified, an agent MUST execute the project-wide verification gate.

## The Verification Gate
Always run the following command from the root of the project:
```bash
just check
```

This single command executes the full sequential verification suite:
1. **Typecheck** (`just typecheck`): Validates static typing (`tsc --noEmit`).
2. **Unit & Integration Tests** (`just test`): Runs all tests via `bun test`.
3. **PTY Render Smoke Test** (`just render`): Spawns real OpenTUI clients inside pseudo-terminals (PTYs), simulates inputs, and validates SGR truecolor output and visual animations.
4. **PTY Click Smoke Test** (`just click`): Simulates and validates terminal click inputs.
5. **PTY Login Smoke Test** (`just login`): Verifies the database persistence and authentication handshake under a pseudo-terminal.

## Acceptable Success Criteria
- **Exit Code**: Must be `0`.
- **Zero Workarounds**: Suppressing compiler errors, skipping tests, or bypassing check scripts is strictly prohibited.
- **Durable Proof**: A task is only considered complete when `just check` is executed and passes completely.
