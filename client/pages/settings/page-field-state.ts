export type PageFieldState = 'editable' | 'readonly' | 'hidden';

export interface PageFieldStateValue {
  visible: boolean;
  writable: boolean;
}

export const stateOfValue = (value: PageFieldStateValue): PageFieldState =>
  !value.visible ? 'hidden' : value.writable ? 'editable' : 'readonly';

export const valueOfState = (state: PageFieldState): PageFieldStateValue =>
  state === 'hidden'
    ? { visible: false, writable: false }
    : state === 'readonly'
      ? { visible: true, writable: false }
      : { visible: true, writable: true };
