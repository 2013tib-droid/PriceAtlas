Utilitas test L3 (bukan kode produksi): bangun database uji dari migration
(`db/tests/build_db.sh` + `db/tests/lib/seed.sql`) dan `PgRpcClient` yang meniru
`supabase.rpc()` lewat PostgREST (transaksi per panggilan, role `authenticated`,
klaim JWT `sub`, error `{message, code, details, hint}`).
