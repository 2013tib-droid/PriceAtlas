'use client';
// R1 get_my_context: household_id (path Storage) dan timezone (tanggal, P-16). Dimuat sekali
// setelah login; staleTime 1 jam dan di-persist (§4.3).
import { MyContextSchema, type MyContext } from '@priceatlas/contracts';
import { useQuery } from '@tanstack/react-query';
import { qk } from '@/lib/data/query-keys';
import { rpcCall } from '@/lib/data/rpc';
import { useAuth } from './session';

export const myContextQuery = {
  queryKey: qk.rpc('get_my_context'),
  queryFn: () => rpcCall<'get_my_context', MyContext>('get_my_context', {}, { output: MyContextSchema }),
};

export function useMyContext() {
  const auth = useAuth();
  return useQuery({ ...myContextQuery, enabled: auth.status === 'signed-in' });
}
