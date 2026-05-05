# Example CSV Requests

Use these to test product behavior and model prompts. For observed real-provider calibration outcomes, see `docs/calibration-notes.md`.

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

## Calibration Request Sets

Use these with the local seeded databases or disposable calibration schemas when checking broader product behavior. They are examples, not benchmark fixtures.

### Retail

```text
Export orders placed last month with customer email, order date, order total, fulfillment status, and region.
```

Expected behavior:

```text
Propose an order-level CSV plan with a date filter and customer/order fields, then export only after approval.
```

```text
Export support tickets opened this quarter with customer email, ticket subject, priority, status, and opened date.
```

Expected behavior:

```text
Propose a ticket-level CSV plan, avoid private notes unless explicitly allowed by policy, and keep one row per ticket.
```

### Finance

```text
Export unpaid invoices with customer name, invoice number, due date, invoice total, amount paid, and outstanding balance.
```

Expected behavior:

```text
Propose an invoice-level CSV plan with a derived outstanding balance and unpaid/past-due filtering.
```

```text
Export recognized revenue by month for 2026 with month, invoice count, gross invoice total, payment total, and refund total.
```

Expected behavior:

```text
Propose a grouped monthly CSV plan and describe any assumptions about recognized revenue.
```

### SaaS / Product Analytics

```text
Create a CSV of active Enterprise accounts with account name, primary owner email, plan name, subscription status, purchased seats, used seats, and utilization rate.
```

Expected behavior:

```text
Propose an account-level CSV plan with utilization as a derived column and preserve the requested column meaning.
```

```text
Make a CSV of accounts at churn risk. Use this formula: churn risk score equals 50 if health score is below 60, plus 25 if utilization is below 0.5, plus 10 for each open high priority ticket. Include account name, health score, utilization rate, open high priority ticket count, and churn risk score.
```

Expected behavior:

```text
Propose an account-level CSV plan that states the formula and validates derived/count columns without requiring exact SQL aliases.
```

```text
Create a CSV with friendly column names for accounts renewed in March 2026. Include account name, renewal date, plan, monthly recurring revenue, and customer success manager.
```

Expected behavior:

```text
Propose friendly CSV labels. This is a useful check for the known CTE/source-lineage edge case when customer success manager comes from a latest-snapshot query.
```

### Marketplace

```text
Create a CSV of orders placed in Q1 2026 with buyer email, seller name, order number, order date, shipment status, destination region, and order total.
```

Expected behavior:

```text
Propose an order-level CSV plan with buyer, seller, order, shipment, and regional fields.
```

```text
Export refund-adjusted revenue by month and product category for 2026. Revenue should subtract refunds.
```

Expected behavior:

```text
Propose a grouped monthly/category CSV plan and state refund allocation assumptions if the schema requires them.
```

```text
Create a seller quality CSV with seller name, average review rating, late shipment count, return count, and a quality score equal to average rating times 20 minus 5 times late shipment count minus 3 times return count.
```

Expected behavior:

```text
Propose a seller-level CSV plan with aggregate counts, average rating, and a derived quality score.
```
