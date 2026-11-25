---
name: terminal
description: "Typing a command into the session's terminal in the Auri app for the user to run, and reading its output: the `terminal.type` command through `run_command` and the `terminal.output` slot through `read_state`. Use when a command only the user can run is needed, such as a sign-in, a password prompt or a browser hand-off, from a session the app started."
---

**Contents**

- **Intent** — the agent types, the user presses Enter.
- **When** — which commands go to the terminal.
- **Steps** — type, ask, read.
- **Limits** — what the terminal does not carry.

## Intent

Each session has its own terminal: a shell in a drawer under the session's tabs. `terminal.type`
puts one command line at that shell's prompt and leaves the Enter to the user, so the user runs a
command the agent cannot finish itself, with the agent able to read what it printed.

## When

Use the terminal for a command that needs the user: a sign-in (`gcloud auth login`), a password
prompt, a browser hand-off. A command the agent can run in its own shell runs there.

## Steps

1. Run the `auri` server's `run_command` tool with `terminal.type` and the command line as its
   string argument. The command types the text at the prompt without Enter, opens the drawer and
   marks the session as needing the user.
2. Ask the user in a forms round (`auri:forms`) to press Enter in the terminal and to answer when
   the command is done. Nothing runs until the user presses Enter.
3. Run `read_state` with slot `terminal.output` and key `$WIGLEY_SESSION_ROW` (the environment
   variable's value, the session's app id). It returns the last 200 lines of the shell's output as
   plain text. Read it to see the result and continue the work.

## Limits

- The text is one line: a line break is refused.
- No Enter is sent.
- The output slot is plain text: a full-screen program, or a key such as Esc, does not read well
  through it.
