/*
 * Локализация интерфейса и ответы «волшебного шара».
 * UI strings and Magic Ball answers (RU / EN).
 */

const I18N = {
  ru: {
    appTitle: 'Магический Шар & Таро',
    tabBall: '🔮 Шар',
    tabTarot: '🃏 Таро',
    // --- Шар ---
    ballHint: 'Задумай вопрос (да/нет) и встряхни телефон или нажми на шар',
    ballThinking: 'Шар думает…',
    askPlaceholder: 'Твой вопрос…',
    shakeBtn: 'Встряхнуть',
    againBtn: 'Ещё раз',
    // --- Таро ---
    chooseSpread: 'Выбери расклад',
    drawBtn: 'Разложить карты',
    redrawBtn: 'Новый расклад',
    reversedLabel: '(перевёрнутая)',
    tapToFlip: 'Нажми на карту, чтобы открыть',
    spreadDoneHint: 'Нажимай на карты, чтобы прочитать трактовки',
    // --- Общее ---
    soundOn: '🔊',
    soundOff: '🔇',
    langBtn: 'EN',
    adLoading: 'Реклама…',
  },
  en: {
    appTitle: 'Magic Ball & Tarot',
    tabBall: '🔮 Ball',
    tabTarot: '🃏 Tarot',
    ballHint: 'Think of a yes/no question and shake your phone or tap the ball',
    ballThinking: 'The ball is thinking…',
    askPlaceholder: 'Your question…',
    shakeBtn: 'Shake',
    againBtn: 'Again',
    chooseSpread: 'Choose a spread',
    drawBtn: 'Draw cards',
    redrawBtn: 'New spread',
    reversedLabel: '(reversed)',
    tapToFlip: 'Tap a card to reveal',
    spreadDoneHint: 'Tap the cards to read their meanings',
    soundOn: '🔊',
    soundOff: '🔇',
    langBtn: 'RU',
    adLoading: 'Ad…',
  },
};

// Ответы шара: 10 положительных, 5 нейтральных, 5 отрицательных (классические 20)
// + расширенный набор для разнообразия.
const BALL_ANSWERS = {
  ru: {
    yes: [
      'Бесспорно',
      'Можешь быть уверен в этом',
      'Определённо да',
      'Звёзды говорят: да',
      'Знаки указывают на «да»',
      'Да',
      'Без сомнений',
      'Скорее всего, да',
      'Хорошие перспективы',
      'Так и будет',
    ],
    neutral: [
      'Пока неясно, попробуй снова',
      'Спроси позже',
      'Лучше не говорить сейчас',
      'Не могу предсказать сейчас',
      'Сосредоточься и спроси ещё раз',
    ],
    no: [
      'Даже не рассчитывай',
      'Мой ответ — нет',
      'Мои источники говорят «нет»',
      'Перспективы не очень',
      'Весьма сомнительно',
    ],
  },
  en: {
    yes: [
      'It is certain',
      'You may rely on it',
      'Without a doubt',
      'The stars say yes',
      'Signs point to yes',
      'Yes',
      'Yes, definitely',
      'Most likely',
      'Outlook good',
      'It is decidedly so',
    ],
    neutral: [
      'Reply hazy, try again',
      'Ask again later',
      'Better not tell you now',
      'Cannot predict now',
      'Concentrate and ask again',
    ],
    no: [
      "Don't count on it",
      'My reply is no',
      'My sources say no',
      'Outlook not so good',
      'Very doubtful',
    ],
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { I18N, BALL_ANSWERS };
}
