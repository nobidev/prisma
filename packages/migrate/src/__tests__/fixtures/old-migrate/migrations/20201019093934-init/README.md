# Migration `20201019093934-init`

This migration has been generated by Joël at 10/19/2020, 11:39:34 AM.
You can check out the [state of the schema](./schema.prisma) after the migration.

## Database Steps

```sql

```

## Changes

```diff
diff --git schema.Prisma schema.prisma
migration ..20201019093934-init
--- datamodel.dml
+++ datamodel.dml
@@ -1,0 +1,14 @@
+datasource my_db {
+  provider = "sqlite"
+  url = "***"
+}
+
+generator client {
+  provider = "prisma-client-js"
+  output   = "@prisma/client"
+}
+
+model Blogss {
+  id          Int @id
+  viewCount20 Int
+}
```