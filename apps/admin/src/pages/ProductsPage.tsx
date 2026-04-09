import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Modal } from '@/components/Modal';
import {
  fetchProducts,
  setProductActive,
  upsertProduct,
  type AdminProduct,
} from '@/lib/mock-data';

function Stars({ n }: { n: number }) {
  return (
    <span className="text-amber-500" title={`${n} / 5`}>
      {Array.from({ length: 5 }, (_, i) => (i < n ? '★' : '☆')).join('')}
    </span>
  );
}

const emptyForm: Omit<AdminProduct, 'id'> = {
  name: '',
  difficulty: 3,
  baseWater: 10,
  couponDays: 14,
  active: true,
};

export function ProductsPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [form, setForm] = useState<Omit<AdminProduct, 'id'>>(emptyForm);

  const { data: products = [], isPending } = useQuery({
    queryKey: ['products'],
    queryFn: fetchProducts,
  });

  const upsertMutation = useMutation({
    mutationFn: upsertProduct,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'stats'] });
      setModalOpen(false);
      setEditingId(undefined);
      setForm(emptyForm);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => setProductActive(id, active),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  function openCreate() {
    setEditingId(undefined);
    setForm(emptyForm);
    setModalOpen(true);
  }

  function openEdit(p: AdminProduct) {
    setEditingId(p.id);
    setForm({
      name: p.name,
      difficulty: p.difficulty,
      baseWater: p.baseWater,
      couponDays: p.couponDays,
      active: p.active,
    });
    setModalOpen(true);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    upsertMutation.mutate(editingId ? { ...form, id: editingId } : { ...form });
  }

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Products</h1>
          <p className="mt-1 text-gray-500">Manage grow kits and catalog items.</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          Add Product
        </button>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 font-semibold text-gray-700">Name</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Difficulty</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Base Water</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Coupon Days</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Active</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isPending ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : (
                products.map((p, i) => (
                  <tr key={p.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/80'}>
                    <td className="px-4 py-3 font-medium text-gray-900">{p.name}</td>
                    <td className="px-4 py-3">
                      <Stars n={p.difficulty} />
                    </td>
                    <td className="px-4 py-3 text-gray-700">{p.baseWater}</td>
                    <td className="px-4 py-3 text-gray-700">{p.couponDays}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={p.active}
                        disabled={toggleMutation.isPending}
                        onClick={() => toggleMutation.mutate({ id: p.id, active: !p.active })}
                        className={[
                          'relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition',
                          p.active ? 'bg-blue-600' : 'bg-gray-200',
                        ].join(' ')}
                      >
                        <span
                          className={[
                            'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition',
                            p.active ? 'translate-x-5' : 'translate-x-0',
                          ].join(' ')}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        className="font-medium text-blue-600 hover:text-blue-800"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingId(undefined);
          setForm(emptyForm);
        }}
        title={editingId ? 'Edit Product' : 'Add Product'}
      >
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700">
              Name
            </label>
            <input
              id="name"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="difficulty" className="block text-sm font-medium text-gray-700">
              Difficulty (1–5)
            </label>
            <select
              id="difficulty"
              value={form.difficulty}
              onChange={(e) => setForm((f) => ({ ...f, difficulty: Number(e.target.value) }))}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? 'star' : 'stars'}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="baseWater" className="block text-sm font-medium text-gray-700">
                Base Water
              </label>
              <input
                id="baseWater"
                type="number"
                min={0}
                required
                value={form.baseWater}
                onChange={(e) => setForm((f) => ({ ...f, baseWater: Number(e.target.value) }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="couponDays" className="block text-sm font-medium text-gray-700">
                Coupon Days
              </label>
              <input
                id="couponDays"
                type="number"
                min={1}
                required
                value={form.couponDays}
                onChange={(e) => setForm((f) => ({ ...f, couponDays: Number(e.target.value) }))}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Active
          </label>
          {upsertMutation.isError ? (
            <p className="text-sm text-red-600">Something went wrong. Try again.</p>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setModalOpen(false);
                setEditingId(undefined);
                setForm(emptyForm);
              }}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={upsertMutation.isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {upsertMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
