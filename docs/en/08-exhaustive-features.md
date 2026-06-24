---
id: exhaustive-features
title: Exhaustive Functionality List
sidebar_position: 8
---

# Exhaustive Functionality List

Beyond standard features, GuLiN Terminal includes specialized internal tools that empower the agentic ecosystem:

## File Management Tools
- `read_dir`, `read_text_file`, `write_text_file`, `edit_text_file`, `delete_text_file`.

## Terminal Control Tools
- `term_run_command`: Executes commands synchronously or asynchronously.
- `term_command_output`: Retrieves real-time output of running commands.
- `term_get_scrollback`: Analyzes previous shell outputs to diagnose errors.
- `term_search`: Searches text within the active terminal buffer.

## Database & API Tools
- `db_query`: Executes safe SQL queries on registered DBs.
- `db_list_connections`, `db_register_connection`, `db_test_connection`, `db_delete_connection`.
- `apimanager_list`, `apimanager_call`, `apimanager_register`, `apimanager_delete`.

## Plugin Ecosystem
- `plugin_list`, `plugin_save`, `plugin_delete`, `plugin_debug`: Used to dynamically inject new behaviors or tools into the environment.
