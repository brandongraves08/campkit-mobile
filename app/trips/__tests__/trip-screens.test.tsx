import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import TripsScreen from '../index';
import TripScreen from '../[tripId]';
import ConflictsScreen from '../conflicts';
import { PackingRow } from '../../../src/components/PackingRow';
import { useTrips } from '../../../src/trips/trips-context';

const mockUseLocalSearchParams = jest.fn(() => ({ tripId: '22222222-2222-4222-8222-222222222222' }));
const mockRouterBack = jest.fn();
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: mockRouterBack }, useLocalSearchParams: () => mockUseLocalSearchParams() }));
jest.mock('expo-network', () => ({ addNetworkStateListener: () => ({ remove: jest.fn() }) }));
jest.mock('../../../src/trips/trips-context', () => ({ useTrips: jest.fn() }));
const tripId = '22222222-2222-4222-8222-222222222222';
const summary = { tripId, name: 'Synthetic ridge trip', destination: 'North Loop', startsOn: '2026-07-01', endsOn: '2026-07-03', status: 'planned' as const };
const downloaded = { ...summary, snapshotAt: '2026-06-30T12:00:00.000Z', downloadedAt: '2026-06-30T12:00:00.000Z', version: 3, packing: [{ entryId: '12', label: 'Synthetic stove', quantity: 1, packed: false, version: 3 }] };
const refreshTrips = jest.fn<() => Promise<typeof summary[]>>();
const getDownloadedTrips = jest.fn<() => Promise<typeof downloaded[]>>();
const downloadTrip = jest.fn<(id: string) => Promise<typeof downloaded>>();
const getPackingSnapshot = jest.fn<(id: string) => Promise<typeof downloaded | null>>();
const setPacked = jest.fn<(tripId: string, entryId: string, packed: boolean) => Promise<any>>();
const syncPendingOperations = jest.fn<() => Promise<any>>();
const listOperations = jest.fn<() => Promise<any[]>>();
const resolveConflict = jest.fn<(id: string, resolution: 'keep_server' | 'apply_local') => Promise<void>>();
const discardOperation = jest.fn<(id: string) => Promise<void>>();

beforeEach(() => {
  jest.clearAllMocks();
  mockUseLocalSearchParams.mockReset();
  mockUseLocalSearchParams.mockReturnValue({ tripId: '22222222-2222-4222-8222-222222222222' });
  refreshTrips.mockResolvedValue([]);
  getDownloadedTrips.mockResolvedValue([]);
  downloadTrip.mockResolvedValue(downloaded);
  getPackingSnapshot.mockResolvedValue(downloaded);
  setPacked.mockResolvedValue({ id: '55555555-5555-4555-8555-555555555555', memberId: 'member-a', householdId: '11111111-1111-4111-8111-111111111111', tripId, entryId: '12', packed: true, baseVersion: 3, status: 'pending', createdAt: '2026-06-30T12:00:00.000Z', errorCode: null });
  syncPendingOperations.mockResolvedValue({ synced: 0, conflicts: 0, needsAttention: 0, paused: false });
  listOperations.mockResolvedValue([]);
  resolveConflict.mockResolvedValue(undefined);
  discardOperation.mockResolvedValue(undefined);
  (useTrips as jest.MockedFunction<typeof useTrips>).mockReturnValue({ refreshTrips, getDownloadedTrips, downloadTrip, getPackingSnapshot, setPacked, syncPendingOperations, listOperations, resolveConflict, discardOperation } as never);
});

describe('trip screens', () => {
  it('shows a useful empty offline state when no trip has been downloaded', async () => {
    refreshTrips.mockRejectedValue(new Error('offline'));
    await render(<TripsScreen />);
    expect(await screen.findByText(/No trips are downloaded yet/i)).toBeTruthy();
  });

  it('shows cached downloads when online listing fails and labels them stale', async () => {
    refreshTrips.mockRejectedValue(new Error('offline'));
    getDownloadedTrips.mockResolvedValue([downloaded]);
    await render(<TripsScreen />);
    expect(await screen.findByRole('button', { name: /Open Synthetic ridge trip offline/i })).toBeTruthy();
    expect(await screen.findByText(/Trips could not be refreshed/i)).toBeTruthy();
    expect(screen.queryByText('Online trips')).toBeNull();
  });

  it('shows loading while online trips and downloaded trips load', async () => {
    let finish!: (value: typeof summary[]) => void;
    refreshTrips.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await render(<TripsScreen />);
    expect(screen.getByText(/Loading trips/i)).toBeTruthy();
    await act(async () => { finish([summary]); });
    expect(await screen.findByText('Synthetic ridge trip')).toBeTruthy();
  });

  it('lists online trips and downloads explicitly with progress and confirmation', async () => {
    refreshTrips.mockResolvedValue([summary]);
    await render(<TripsScreen />);
    const button = await screen.findByRole('button', { name: /Download Synthetic ridge trip/i });
    await act(async () => { fireEvent.press(button); await Promise.resolve(); });
    expect(downloadTrip).toHaveBeenCalledWith(tripId);
    expect(await screen.findByText(/Downloaded for offline use/i)).toBeTruthy();
    expect(screen.getAllByText('Synthetic ridge trip')).toHaveLength(1);
  });

  it('shows per-trip download progress until persistence completes', async () => {
    refreshTrips.mockResolvedValue([summary]);
    let finish!: (value: typeof downloaded) => void;
    downloadTrip.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await render(<TripsScreen />);
    await act(async () => { fireEvent.press(await screen.findByRole('button', { name: /Download Synthetic ridge trip/i })); });
    expect(screen.getByRole('button', { name: /Download Synthetic ridge trip/i })).toBeDisabled();
    expect(screen.getByText('Downloading…')).toBeTruthy();
    await act(async () => { finish(downloaded); });
    expect(await screen.findByText(/Downloaded for offline use/i)).toBeTruthy();
  });

  it('shows a retryable failure without claiming an offline-ready trip', async () => {
    refreshTrips.mockResolvedValue([summary]);
    downloadTrip.mockRejectedValue(new Error('network failed'));
    await render(<TripsScreen />);
    await act(async () => { fireEvent.press(await screen.findByRole('button', { name: /Download Synthetic ridge trip/i })); });
    expect(await screen.findByRole('alert')).toHaveTextContent(/Download failed/i);
    expect(screen.queryByText(/Downloaded for offline use/i)).toBeNull();
  });

  it('opens a cached snapshot cold without needing the online trip list', async () => {
    await render(<TripScreen />);
    expect(await screen.findByText('Synthetic stove')).toBeTruthy();
    expect(refreshTrips).not.toHaveBeenCalled();
    expect(getPackingSnapshot).toHaveBeenCalledWith(tripId);
  });

  it('exposes packed state as a native switch and a visible text label', async () => {
    const row = downloaded.packing[0];
    const { rerender } = await render(<PackingRow row={row} onChange={() => {}} />);
    expect(screen.getByRole('switch', { name: 'Synthetic stove', checked: false })).toBeTruthy();
    expect(screen.getByText('Not packed')).toBeTruthy();

    await rerender(<PackingRow row={{ ...row, packed: true }} onChange={() => {}} />);
    expect(screen.getByRole('switch', { name: 'Synthetic stove', checked: true })).toBeTruthy();
    expect(screen.getByText('Packed')).toBeTruthy();
  });

  it('allows packed-state changes only through the downloaded snapshot', async () => {
    await render(<TripScreen />);
    const checkbox = await screen.findByRole('switch', { name: /Synthetic stove/i });
    await act(async () => { fireEvent(checkbox, 'valueChange', true); });
    expect(setPacked).toHaveBeenCalledWith(tripId, '12', true);
    expect(await screen.findByText('Pending sync · Packed')).toBeTruthy();
  });

  it.each([
    ['Keep server', 'keep_server'],
    ['Apply my value', 'apply_local'],
  ] as const)('shows the server/local values and applies explicit %s resolution', async (label, resolution) => {
    const conflict = { id: '55555555-5555-4555-8555-555555555555', memberId: 'member-a', householdId: '11111111-1111-4111-8111-111111111111', tripId, entryId: '12', packed: true, baseVersion: 3, status: 'conflict' as const, createdAt: '2026-06-30T12:00:00.000Z', errorCode: 'version_conflict' };
    mockUseLocalSearchParams.mockReturnValue({ operationId: conflict.id } as never);
    listOperations.mockResolvedValueOnce([conflict]);
    await render(<ConflictsScreen />);
    expect(await screen.findByText('Not packed')).toBeTruthy();
    expect(screen.getByText('Packed')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByRole('button', { name: label === 'Keep server' ? 'Keep server value' : label })); });
    expect(resolveConflict).toHaveBeenCalledWith(conflict.id, resolution);
  });

  it('shows an explicit attention state and discard action for unsyncable operations', async () => {
    listOperations.mockResolvedValueOnce([{ id: '55555555-5555-4555-8555-555555555555', memberId: 'member-a', householdId: '11111111-1111-4111-8111-111111111111', tripId, entryId: '12', packed: true, baseVersion: 3, status: 'needs_attention', createdAt: '2026-06-30T12:00:00.000Z', errorCode: 'not_found' }]);
    await render(<TripScreen />);
    expect(await screen.findByText(/Needs attention · This item is unavailable or access may have changed/)).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Discard unsyncable packing change' })); });
    expect(discardOperation).toHaveBeenCalledWith('55555555-5555-4555-8555-555555555555');
  });

  it('shows stale/offline state and does not offer edits when no local snapshot exists', async () => {
    getPackingSnapshot.mockResolvedValue(null);
    await render(<TripScreen />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/not downloaded/i);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(setPacked).not.toHaveBeenCalled();
  });
});
