/**
 * Vehicles API — ยานพาหนะ
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import type { Vehicle } from '../types';

export const vehicleKeys = {
  all: ['vehicles'] as const,
  list: (filter?: { isImpounded?: boolean; licensePlate?: string; ownerName?: string }) =>
    ['vehicles', 'list', filter ?? {}] as const,
  byId: (id: string) => ['vehicles', 'byId', id] as const,
  byPlate: (plate: string) => ['vehicles', 'byPlate', plate] as const,
};

export function useVehicles(filter?: { isImpounded?: boolean; licensePlate?: string; ownerName?: string }) {
  return useQuery({
    queryKey: vehicleKeys.list(filter),
    queryFn: async () => {
      let q = supabase.from('vehicles').select('*').order('license_plate');
      if (filter?.isImpounded !== undefined) q = q.eq('is_impounded', filter.isImpounded);
      if (filter?.licensePlate) q = q.ilike('license_plate', `%${filter.licensePlate}%`);
      if (filter?.ownerName) q = q.ilike('owner_name', `%${filter.ownerName}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Vehicle[];
    },
  });
}

export function useVehicleByPlate(plate: string | null) {
  return useQuery({
    queryKey: vehicleKeys.byPlate(plate ?? ''),
    enabled: !!plate,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .ilike('license_plate', plate!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as Vehicle | null;
    },
  });
}

export function useCreateVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<Vehicle, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase.from('vehicles').insert(input).select().single();
      if (error) throw error;
      return data as Vehicle;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: vehicleKeys.all }),
  });
}

export function useUpdateVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Vehicle> }) => {
      const { data, error } = await supabase
        .from('vehicles')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as Vehicle;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: vehicleKeys.all });
      qc.invalidateQueries({ queryKey: vehicleKeys.byId(data.id) });
    },
  });
}

export function useImpoundVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      reason,
      location,
      impoundedBy,
      impoundedByName,
    }: {
      id: string;
      reason: string;
      location: string;
      impoundedBy: string;
      impoundedByName: string;
    }) => {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('vehicles')
        .update({
          is_impounded: true,
          impound_reason: reason,
          impound_location: location,
          impounded_at: now,
          impounded_by: impoundedBy,
          impounded_by_name: impoundedByName,
          updated_at: now,
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as Vehicle;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: vehicleKeys.all }),
  });
}

export function useReleaseVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      releasedBy,
      releasedByName,
    }: {
      id: string;
      releasedBy: string;
      releasedByName: string;
    }) => {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('vehicles')
        .update({
          is_impounded: false,
          released_at: now,
          released_by: releasedBy,
          released_by_name: releasedByName,
          impound_reason: null,
          impound_location: null,
          impounded_at: null,
          impounded_by: null,
          impounded_by_name: null,
          updated_at: now,
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as Vehicle;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: vehicleKeys.all }),
  });
}
