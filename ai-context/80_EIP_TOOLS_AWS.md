# eip-tools / AWS safety + workflow

`~/workspace/olivers-tools` is commonly referred to as `eip-tools`.

## Hard safety rule

- You may run **read-only** AWS CLI commands without asking.
- You must stop and obtain explicit permission before running any AWS-modifying action, including:
  - `npm run deploy|reconfigure|teardown`
  - anything `create*`, `update*`, `put*`, `delete*`, `tag*`

## Default workflow

1) Discovery (read-only): identify the exact resource IDs/ARNs/routes/stages.
2) Propose the minimal write commands using the real identifiers.
3) Wait for a clear “yes, run it”.
4) Execute + verify.

