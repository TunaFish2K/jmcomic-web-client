import { describe, expect, it, vi } from 'vitest';
import { fetchPhotoWithScrambleId } from '../src/index';

type ClientContext = Parameters<typeof fetchPhotoWithScrambleId>[0];

describe('upstream photo loading', () => {
	it('starts photo metadata and scramble requests concurrently', async () => {
		let resolvePhoto!: (value: { id: string; name: string; images: never[] }) => void;
		let resolveScramble!: (value: number) => void;
		const getPhoto = vi.fn(() => new Promise<{ id: string; name: string; images: never[] }>((resolve) => {
			resolvePhoto = resolve;
		}));
		const getScrambleId = vi.fn(() => new Promise<number>((resolve) => {
			resolveScramble = resolve;
		}));
		const pending = fetchPhotoWithScrambleId({
			domain: 'upstream.test',
			client: { getPhoto, getScrambleId },
		} as unknown as ClientContext, '42');

		expect(getPhoto).toHaveBeenCalledWith('42');
		expect(getScrambleId).toHaveBeenCalledWith('42');
		resolvePhoto({ id: '42', name: 'chapter', images: [] });
		resolveScramble(7);
		expect(await pending).toEqual({ id: '42', name: 'chapter', images: [], scrambleId: 7 });
	});

	it('reports the failed upstream stage and preserves not-found responses', async () => {
		const photoFailure = fetchPhotoWithScrambleId({
			domain: 'upstream.test',
			client: {
				getPhoto: async () => { throw new Error('photo failed'); },
				getScrambleId: async () => 1,
			},
		} as unknown as ClientContext, 'photo-error');
		await expect(photoFailure).rejects.toMatchObject({ stage: 'get_photo', domain: 'upstream.test' });

		const scrambleFailure = fetchPhotoWithScrambleId({
			domain: 'upstream.test',
			client: {
				getPhoto: async () => ({ id: '1', name: 'chapter', images: [] }),
				getScrambleId: async () => { throw new Error('scramble failed'); },
			},
		} as unknown as ClientContext, 'scramble-error');
		await expect(scrambleFailure).rejects.toMatchObject({ stage: 'get_scramble_id', domain: 'upstream.test' });

		await expect(fetchPhotoWithScrambleId({
			domain: 'upstream.test',
			client: {
				getPhoto: async () => null,
				getScrambleId: async () => 1,
			},
		} as unknown as ClientContext, 'missing')).resolves.toBeNull();
	});
});
