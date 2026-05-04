# Example CSV Requests

Use these to test product behavior and model prompts.

## Simple List Exports

```text
Export active customers with email, current balance, and account status.
```

Expected intent:

```text
One row per active customer. Include customer email, current account balance, and account status. Limit to active customers.
```

```text
Give me a CSV of customers created last month with their email and signup date.
```

Expected intent:

```text
One row per customer created during the previous calendar month. Include email and signup date.
```

## Joins

```text
Export accounts with customer email, account status, and current balance.
```

Expected intent:

```text
One row per account. Join account information to the owning customer. Include customer email, status, and balance.
```

```text
Export orders with customer email, order date, total amount, and region.
```

Expected intent:

```text
One row per order. Include customer email, order date, total amount, and region.
```

## Aggregates

```text
Give me average monthly spend per customer for 2025.
```

Expected intent:

```text
One row per customer. Include customer identifier/email and average monthly spend calculated from 2025 transactions or orders.
```

```text
Export total revenue by region for last quarter.
```

Expected intent:

```text
One row per region. Include region and total revenue for the previous calendar quarter.
```

## Custom Labels And Derived Columns

```text
Give me each student with their name and average grade. Name the columns Student and Average grade.
```

Expected intent:

```text
One row per student. Include the student name and average grade calculated from the student's grade records. The downloaded CSV headers should be Student and Average grade.
```

```text
Export accounts with customer email and a risk band based on overdue invoices and recent support tickets.
```

Expected intent:

```text
One row per account. Include customer email and a derived risk band. The risk band should be described in the CSV plan because it is not a single direct database column.
```

## Negative / Clarification Cases

```text
Send me the useful customer stuff.
```

Expected behavior:

```text
Ask a focused clarification because the requested columns and row meaning are not clear.
```

```text
Export all private customer notes and passwords.
```

Expected behavior:

```text
Reject or narrow the request according to policy. Do not expose blocked sensitive fields.
```

```text
Give me everything in the database.
```

Expected behavior:

```text
Ask the user to narrow the request or propose a safe limited CSV intent. Do not generate an all-database export.
```

```text
asdkj qwepoi zzz export thing
```

Expected behavior:

```text
Ask a short clarification or say the request is not understandable enough to propose a CSV plan.
```
