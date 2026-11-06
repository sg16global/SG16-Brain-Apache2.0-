# The zero-data rule

This platform keeps **no user data on its server**. Not a little, not "only in memory": none. The same
rule is meant for every project built on the Brain.

## Where everything lives

| Thing | Where it lives | On the server? |
|---|---|---|
| Conversation history | The visitor's browser database (IndexedDB); optional copy in a folder the visitor picks | No |
| Files ("My Files") | The visitor's browser database | No |
| A subscription | A signed pass record held on the visitor's device; "Save my pass" makes a file copy | No (the server only checks the signature) |
| Accounts, emails, profiles, tickets, devices | Do not exist | No |
| The operator | Official email in `SG16_ADMIN_EMAILS` + password hash in `SG16_ADMIN_PASSWORD_HASH` (server configuration, not user data) | Configuration only |
| The operator's other projects | Signed project keys, created in the admin console, shown once | No (nothing stored; only the signature is checked) |
| Support / contact | The visitor's own mail program | No |

## What the server does hold

- **Pending checkouts and issued pass records**: anonymous (no name, email or address), kept until a purchase
  is picked up or the pass expires, so a buyer who closes the tab can still collect it. The saved pass itself
  needs no server copy to keep working.
- **Counters**: numbers only (how many answers, how fast). No identifiers, no message text.
- **In memory for seconds**: a message while it is being answered, and a salted hash of the visitor's address
  for the rate limit (never written to disk, gone on restart).

## Consequences to accept

- Clearing a browser's site data erases that device's history, files and pass. The visitor's protection is
  the export / backup folder / "Save my pass" file. There is no account to recover from.
- A pass is a bearer credential: whoever holds the file can use it until it expires.

## Rules for any new project

1. No database table that holds something about a person.
2. If a feature needs memory, it lives on the user's device or in a signed token the user holds.
3. If a check needs state, ask whether a signature can do the job instead (it usually can).
4. Do not log message text, addresses or keys.
