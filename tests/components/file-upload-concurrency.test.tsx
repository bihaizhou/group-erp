import { useState } from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type {
  ClientFileRepository,
  FileRecord,
  UploadOneResult,
} from '@nocobase/app-plugin-file/client';
import { FileUploadField } from '../../client/extensions/nocobase-file-component-ui/components/file-upload-field.js';
vi.mock('@nocobase/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));
it('retains every completion when another upload settles before the parent commit', async () => {
  const releases = new Map<string, (value: UploadOneResult) => void>(),
    changed = vi.fn();
  const repository = {
    uploadOne: vi.fn(
      ({ file }: { file: File }) =>
        new Promise<UploadOneResult>((resolve) =>
          releases.set(file.name, resolve),
        ),
    ),
  } as unknown as ClientFileRepository;
  const record = (name: string): FileRecord => ({
    id: name,
    disk: 'local',
    key: name,
    filename: name,
    ext: 'txt',
    mimeType: 'text/plain',
    size: 1,
    createdAt: '2026-10-18',
    updatedAt: '2026-10-18',
  });
  function Harness() {
    const [files, setFiles] = useState<readonly FileRecord[]>([]);
    return (
      <>
        <FileUploadField
          repository={repository}
          value={files}
          onChange={(next) => {
            changed(next);
            setFiles(next);
          }}
          multiple
          labels={{ choose: 'Choose files' }}
        />
        <output data-testid='selected'>
          {files.map((file) => file.id).join(',')}
        </output>
      </>
    );
  }
  const view = render(<Harness />),
    input = view.container.querySelector<HTMLInputElement>('input[type=file]')!;
  await userEvent.upload(input, [
    new File(['a'], 'a.txt'),
    new File(['b'], 'b.txt'),
    new File(['c'], 'c.txt'),
  ]);
  await waitFor(() => expect(releases.size).toBe(3));
  await act(async () => {
    for (const name of ['a.txt', 'b.txt', 'c.txt']) {
      releases.get(name)!({ record: record(name), createdTargets: [] });
      await Promise.resolve();
      await Promise.resolve();
    }
  });
  expect(screen.getByTestId('selected')).toHaveTextContent('a.txt,b.txt,c.txt');
  expect(changed.mock.calls.at(-1)![0]).toHaveLength(3);
  expect(repository.uploadOne).toHaveBeenCalledTimes(3);
});

it('keeps save and close locked after one failure until the remaining upload settles', async () => {
  let fail: (error: Error) => void = () => {},
    finish: (result: UploadOneResult) => void = () => {};
  const status = vi.fn();
  const repository = {
    uploadOne: vi.fn(
      ({ file }: { file: File }) =>
        new Promise<UploadOneResult>((resolve, reject) => {
          if (file.name === 'bad.txt') fail = reject;
          else finish = resolve;
        }),
    ),
  } as unknown as ClientFileRepository;
  function Harness() {
    const [files, setFiles] = useState<readonly FileRecord[]>([]),
      [busy, setBusy] = useState(false);
    return (
      <>
        <FileUploadField
          repository={repository}
          value={files}
          onChange={setFiles}
          onStatusChange={(state) => {
            status(state);
            setBusy(state === 'uploading');
          }}
          multiple
          labels={{ choose: 'Choose files' }}
        />
        <button disabled={busy}>Save</button>
        <button disabled={busy}>Close</button>
      </>
    );
  }
  const view = render(<Harness />);
  await userEvent.upload(
    view.container.querySelector<HTMLInputElement>('input[type=file]')!,
    [new File(['bad'], 'bad.txt'), new File(['good'], 'good.txt')],
  );
  await waitFor(() => expect(repository.uploadOne).toHaveBeenCalledTimes(2));
  await act(async () => {
    fail(new Error('Temporary upload failure'));
    await Promise.resolve();
  });
  await expect(
    screen.findByRole('button', { name: 'Retry: bad.txt' }),
  ).resolves.toBeDefined();
  expect(status.mock.calls.at(-1)![0]).toBe('uploading');
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
  await act(async () => {
    finish({
      record: {
        id: 'good',
        disk: 'local',
        key: 'good',
        filename: 'good.txt',
        ext: 'txt',
        mimeType: 'text/plain',
        size: 4,
        createdAt: '2026-10-18',
        updatedAt: '2026-10-18',
      },
      createdTargets: [],
    });
  });
  await waitFor(() => expect(status.mock.calls.at(-1)![0]).toBe('error'));
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
});
