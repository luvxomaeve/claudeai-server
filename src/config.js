// Подключение к VRoid Hub. Заполняется после регистрации приложения и запуска воркера.
// clientId — это публичный Application ID (не секрет). Secret сюда НЕ вписывать!
export const VROID_HUB = {
  clientId: '',
  workerUrl: '', // например https://vroid-hub-proxy.<твой-аккаунт>.workers.dev
  redirectUri: '', // по умолчанию — адрес текущей страницы
  ...(typeof window !== 'undefined' ? window.WAIFU_VROID_HUB : {}), // переопределение для тестов
};
