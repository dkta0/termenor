#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

LOOP_STATE_FILE = Path(".termenor-loop.json")

# ANSI color codes for terminal feedback
RESET = "\033[0m"
BOLD = "\033[1m"
GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
MAGENTA = "\033[35m"

def log_info(msg):
    print(f"{CYAN}{BOLD}[Advisor]{RESET} {msg}")

def log_success(msg):
    print(f"{GREEN}{BOLD}[Success]{RESET} {msg}")

def log_warning(msg):
    print(f"{YELLOW}{BOLD}[Warning]{RESET} {msg}")

def log_error(msg):
    print(f"{RED}{BOLD}[Error]{RESET} {msg}")

def run_command(cmd, shell=True, capture_output=True):
    try:
        result = subprocess.run(cmd, shell=shell, text=True, capture_output=capture_output)
        return result.returncode, result.stdout, result.stderr
    except Exception as e:
        return -1, "", str(e)

def init_state(task_desc):
    state = {
        "status": "pending",
        "attempt": 1,
        "max_attempts": 3,
        "task": {
            "description": task_desc,
            "verification_command": "just check"
        },
        "feedback": {
            "edited_files": [],
            "error_log": ""
        }
    }
    with open(LOOP_STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)
    log_info(f"Initialized state in {LOOP_STATE_FILE}")
    return state

def load_state():
    if not LOOP_STATE_FILE.exists():
        return None
    with open(LOOP_STATE_FILE, "r") as f:
        return json.load(f)

def update_state(state):
    with open(LOOP_STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

def run_claude_developer(state):
    log_info(f"Launching Claude Code CLI (Attempt {state['attempt']}/{state['max_attempts']})...")
    
    # Prompt instructing Claude to read the state, do the work, and output the result.
    prompt = (
        f"Read '{LOOP_STATE_FILE}'. Implement the requested changes for the task: "
        f"\"{state['task']['description']}\". "
        f"If you are fixing a previous failure, the compiler/test error logs are in the state file. "
        f"After completing the edit, update '{LOOP_STATE_FILE}': "
        f"set 'status' to 'completed', and populate 'feedback.edited_files' with the files you changed. "
        f"Then exit. Do not run any full-project test suites (like just check or bun test) — the orchestrator will handle verification."
    )
    
    # Run Claude Code CLI on the workstation
    # We pass the prompt directly as an argument.
    code, stdout, stderr = run_command(f"claude '{prompt}' --yes", capture_output=False)
    return code

def verify_work(state):
    cmd = state["task"]["verification_command"]
    log_info(f"Running verification command: {cmd} ...")
    
    code, stdout, stderr = run_command(cmd, capture_output=True)
    
    combined_output = stdout + "\n" + stderr
    if code == 0:
        log_success("Verification gate PASSED!")
        state["status"] = "verified"
        state["feedback"]["error_log"] = ""
        update_state(state)
        return True
    else:
        log_error("Verification gate FAILED!")
        # Truncate very long error logs to avoid token bloat in the loop
        lines = combined_output.splitlines()
        truncated_errors = "\n".join(lines[-40:]) # Grab last 40 lines of log
        state["status"] = "failed"
        state["feedback"]["error_log"] = truncated_errors
        update_state(state)
        return False

def main():
    parser = argparse.ArgumentParser(description="Bidirectional Local Agent-to-Agent Loop")
    parser.add_argument("task", type=str, nargs="?", help="Description of the task to solve")
    parser.add_argument("--resume", action="store_true", help="Resume from existing state file")
    args = parser.parse_args()

    if args.resume:
        state = load_state()
        if not state:
            log_error("No state file found to resume. Please provide a task description.")
            sys.exit(1)
        log_info("Resuming active loop...")
    else:
        if not args.task:
            log_error("Please provide a task description or use --resume.")
            sys.exit(1)
        state = init_state(args.task)

    while state["attempt"] <= state["max_attempts"]:
        # 1. Spawn Claude Code to perform the development work
        run_claude_developer(state)
        
        # Reload state to get Claude's feedback
        state = load_state()
        
        # 2. Verify Claude's work using local tests/typechecks
        success = verify_work(state)
        if success:
            log_success(f"Task successfully implemented and verified in {state['attempt']} attempts!")
            
            # Offer Git commit option
            commit_cmd = f"git add -u && git commit -m 'feat: {state['task']['description'][:50]} (automated loop)'"
            log_info(f"Would you like to commit these changes? Run:\n  {commit_cmd}")
            
            # Remove loop file on successful completion to stay clean
            if LOOP_STATE_FILE.exists():
                LOOP_STATE_FILE.unlink()
            break
        else:
            state["attempt"] += 1
            if state["attempt"] > state["max_attempts"]:
                log_error("Reached maximum attempts. Handing back control to user.")
                break
            else:
                log_warning(f"Retrying. Errors have been logged to {LOOP_STATE_FILE} for Claude's review.")
                update_state(state)

if __name__ == "__main__":
    main()
