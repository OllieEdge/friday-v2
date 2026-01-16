# Jira access (Telegraph)

## Auth (Mac mini)

Jira calls should run on the Mac mini and use env vars from `friday-v2/.env`:

- `JIRA_BASE_URL=https://telegraph.atlassian.net`
- `JIRA_EMAIL=...`
- `JIRA_API_TOKEN=...`

## Access pattern

Use Jira REST API v3 with basic auth:

```
GET /rest/api/3/issue/{KEY}
```

Example fields query:

```
/rest/api/3/issue/TSD-12345?fields=summary,description,reporter,assignee,created,status,priority,labels
```

## Notes

- Only request the fields needed for triage.
- Do not paste tokens in chat or commit them to git.
