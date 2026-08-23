export type ReaderNetworkCapabilities = {
  saveData?: boolean;
  effectiveType?: string;
  deviceMemory?: number;
  hardwareConcurrency?: number;
};

type NavigatorWithConnection = Navigator & {
  connection?: EventTarget & {
    saveData?: boolean;
    effectiveType?: string;
  };
  deviceMemory?: number;
};

export function getReaderImageConcurrency({
  saveData = false,
  effectiveType,
  deviceMemory,
  hardwareConcurrency,
}: ReaderNetworkCapabilities) {
  if (saveData || effectiveType === 'slow-2g' || effectiveType === '2g') return 1;
  if (
    effectiveType === '3g'
    || (deviceMemory !== undefined && deviceMemory <= 4)
    || (hardwareConcurrency !== undefined && hardwareConcurrency <= 4)
  ) return 2;
  if (
    effectiveType === '4g'
    && deviceMemory !== undefined
    && deviceMemory >= 8
    && hardwareConcurrency !== undefined
    && hardwareConcurrency >= 8
  ) return 4;
  return 3;
}

export function canPrefetchAdjacentChapter({
  saveData = false,
  effectiveType,
}: Pick<ReaderNetworkCapabilities, 'saveData' | 'effectiveType'>) {
  return !saveData && effectiveType !== 'slow-2g' && effectiveType !== '2g';
}

export function getBrowserReaderNetworkCapabilities(
  navigatorValue: Navigator = navigator,
): ReaderNetworkCapabilities {
  const extended = navigatorValue as NavigatorWithConnection;
  return {
    saveData: extended.connection?.saveData,
    effectiveType: extended.connection?.effectiveType,
    deviceMemory: extended.deviceMemory,
    hardwareConcurrency: extended.hardwareConcurrency,
  };
}

export function subscribeToReaderNetworkChanges(
  callback: (capabilities: ReaderNetworkCapabilities) => void,
  navigatorValue: Navigator = navigator,
) {
  const extended = navigatorValue as NavigatorWithConnection;
  const connection = extended.connection;
  if (!connection) return () => {};
  const onChange = () => callback(getBrowserReaderNetworkCapabilities(navigatorValue));
  connection.addEventListener('change', onChange);
  return () => connection.removeEventListener('change', onChange);
}
