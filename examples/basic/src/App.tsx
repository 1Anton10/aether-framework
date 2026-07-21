export default function App() {
  return (
    <div className="tour">
      <header className="tour-nav">
        <a className="tour-logo" href="/">
          Aether
        </a>
        <span className="tour-pill">Демо · как это работает</span>
        <a href="/#compare">Сравнение</a>
        <a href="/guide.html">Guide</a>
        <a href="/api.html">API</a>
      </header>

      <section className="tour-intro">
        <h1>Что умеет Aether — на живом примере</h1>
        <p>
          Ниже четыре шага. Каждый показывает одну идею фреймворка простыми
          словами. Нажимайте кнопки и читайте блок «Что произошло».
        </p>
      </section>

      <ol className="tour-steps">
        <li className="tour-step">
          <div className="tour-step-head">
            <span className="tour-num">1</span>
            <div>
              <h2>Мгновенное обновление без Virtual DOM</h2>
              <p className="tour-why">
                В React при клике часто пересобирается дерево компонентов. В
                Aether клик вызывает Wasm-функцию: меняется одна ячейка памяти,
                и обновляется только нужный текст на экране.
              </p>
            </div>
          </div>
          <div className="tour-demo">
            <div className="tour-demo-ui">
              <p className="tour-label">Товары в корзине</p>
              <p className="tour-big">{cart}</p>
              <div className="tour-btns">
                <button onClick={add_item}>Добавить товар</button>
                <button onClick={remove_item}>Убрать</button>
                <button onClick={clear_cart}>Очистить</button>
              </div>
            </div>
            <aside className="tour-explain">
              <h3>Что произошло</h3>
              <p>
                Handler <code>add_item</code> в Wasm сделал
                <code>apply_delta</code> только для слота корзины. Остальная
                страница не «перерисовалась» целиком.
              </p>
            </aside>
          </div>
        </li>

        <li className="tour-step">
          <div className="tour-step-head">
            <span className="tour-num">2</span>
            <div>
              <h2>Автоматический пересчёт зависимых значений</h2>
              <p className="tour-why">
                Цена и бонусы считаются из корзины по графу зависимостей. Вы не
                пишете setState для каждого поля — Aether сам помечает «грязные»
                слоты и обновляет только их.
              </p>
            </div>
          </div>
          <div className="tour-demo">
            <div className="tour-demo-ui">
              <p className="tour-flow">
                корзина <strong>{cart}</strong>
                <span>→</span>
                сумма ×2 <strong>{total}</strong>
                <span>→</span>
                бонусы ×10 <strong>{points}</strong>
              </p>
              <p className="tour-hint">
                Добавьте товар выше — сумма и бонусы изменятся сами.
              </p>
            </div>
            <aside className="tour-explain">
              <h3>Что произошло</h3>
              <p>
                Это derived DAG: <code>cart → total → points</code>. Нет
                reconcile всего UI — только цепочка затронутых значений.
              </p>
            </aside>
          </div>
        </li>

        <li className="tour-step">
          <div className="tour-step-head">
            <span className="tour-num">3</span>
            <div>
              <h2>Синхронизация с сервером крошечными байтами</h2>
              <p className="tour-why">
                Обычно SPA шлёт JSON. Aether шлёт бинарную дельту: номер слота +
                4 байта значения (~12 байт). Откройте Network →
                <code>/api/delta</code>.
              </p>
            </div>
          </div>
          <div className="tour-demo">
            <div className="tour-demo-ui">
              <p className="tour-label">Корзина на сервере (после sync)</p>
              <p className="tour-big">{cart}</p>
              <div className="tour-btns">
                <button onClick={sync_cart}>Синхронизировать +1 на сервер</button>
              </div>
              <p className="tour-wire" id="tour-wire">
                Нажмите sync — здесь появится размер ответа.
              </p>
            </div>
            <aside className="tour-explain">
              <h3>Что произошло</h3>
              <p>
                Запрос ушёл как binary DSM, не как JSON-объект. Тот же кодек
                работает через WebSocket и WebTransport.
              </p>
            </aside>
          </div>
        </li>

        <li className="tour-step">
          <div className="tour-step-head">
            <span className="tour-num">4</span>
            <div>
              <h2>Эффект: запрос к «базе» без блокировки UI</h2>
              <p className="tour-why">
                Кнопка запускает algebraic effect: Wasm делает suspend, хост
                ходит на сервер, затем resume пишет ответ в слот. Страница не
                зависает.
              </p>
            </div>
          </div>
          <div className="tour-demo">
            <div className="tour-demo-ui">
              <p className="tour-row">
                <span>Ответ каталога (db.get)</span>
                <strong>{catalog}</strong>
              </p>
              <p className="tour-row">
                <span>Пинг сервера, мс (эмуляция)</span>
                <strong>{pingMs}</strong>
              </p>
              <div className="tour-btns">
                <button onClick={load_catalog}>Загрузить каталог</button>
                <button onClick={measure_ping}>Измерить ping</button>
              </div>
            </div>
            <aside className="tour-explain">
              <h3>Что произошло</h3>
              <p>
                Смотрите <code>/api/effect</code> в Network. Это не
                async/await в компоненте — это perform → handler → resume в
                память Wasm.
              </p>
            </aside>
          </div>
        </li>
      </ol>

      <section className="tour-finale">
        <h2>И ещё: страница уже пришла с HTML (SSR)</h2>
        <p>
          View Source / Elements: у корня есть
          <code>data-aether-ssr="1"</code> и узлы с
          <code>data-aether-nid</code>. Браузер не «собирает UI с нуля» — он
          подхватывает серверный HTML и binary snapshot в
          <code>&lt;script type="aether/snapshot"&gt;</code>.
        </p>
        <p className="tour-finale-links">
          <a className="tour-cta" href="/#compare">
            Сравнить с React/Nuxt →
          </a>
          <a href="/guide.html">Как начать проект</a>
        </p>
      </section>
    </div>
  );
}
