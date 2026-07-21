export default function App() {
  return (
    <div className="tour">
      <header className="tour-nav">
        <a className="tour-logo" href="/">
          Aether
        </a>
        <span className="tour-pill">Demo v0.2</span>
        <a href="/#compare">Compare</a>
        <a href="/guide.html">Guide</a>
        <a href="/api.html">API</a>
      </header>

      <section className="tour-intro">
        <h1>Demo</h1>
        <p>
          Живой reference runtime: слоты в Wasm, dirty DAG, binary DSM, effects и
          SSR. Кнопки бьют в реальные эндпоинты (<code>/api/delta</code>,{" "}
          <code>/api/effect</code>, <code>/api/catalog</code>).
        </p>
        <ul className="tour-why-list" id="viz-why">
          <li>
            <strong>DOM patch</strong> — изменение слота обновляет один text-node
          </li>
          <li>
            <strong>Dirty DAG</strong> — derived пересчитываются только по рёбрам
          </li>
          <li>
            <strong>Binary DSM</strong> — sync уходит кадром, не JSON-документом
          </li>
          <li>
            <strong>Effects</strong> — suspend → host → resume в слот
          </li>
          <li>
            <strong>SSR</strong> — HTML с <code>data-aether-nid</code> уже в ответе
          </li>
        </ul>
        <p className="tour-runtime" id="viz-runtime">
          runtime —
        </p>
      </section>

      <ol className="tour-steps">
        <li className="tour-step" data-tour="cart">
          <div className="tour-step-head">
            <span className="tour-num">1</span>
            <div>
              <h2>DOM patch</h2>
              <p className="tour-why">
                Запись в слот <code>cart</code> в Wasm-памяти патчит один
                text-node; дерево страницы не пересобирается.
              </p>
            </div>
          </div>
          <div className="tour-demo">
            <div className="tour-demo-ui">
              <p className="tour-label">cart</p>
              <p className="tour-big" id="viz-cart-n">
                {cart}
              </p>
              <div className="viz-shelf" id="viz-cart-shelf"></div>
              <div className="tour-btns">
                <button onClick={add_item}>+</button>
                <button onClick={remove_item}>−</button>
                <button onClick={clear_cart}>Clear</button>
              </div>
            </div>
            <aside className="tour-explain">
              <h3>Статус</h3>
              <div className="viz-log" id="viz-cart-log">
                —
              </div>
            </aside>
          </div>
        </li>

        <li className="tour-step" data-tour="dag">
          <div className="tour-step-head">
            <span className="tour-num">2</span>
            <div>
              <h2>Dirty DAG</h2>
              <p className="tour-why">
                Derived-рёбра <code>cart → total → points</code>: при изменении
                корзины пересчитывается только эта цепочка.
              </p>
            </div>
          </div>
          <div className="tour-demo">
            <div className="tour-demo-ui">
              <div className="viz-dag" id="viz-dag">
                <div className="viz-node" data-k="cart">
                  <span>cart</span>
                  <strong id="viz-dag-cart">{cart}</strong>
                </div>
                <div className="viz-arrow">→</div>
                <div className="viz-node" data-k="total">
                  <span>total</span>
                  <strong id="viz-dag-total">{total}</strong>
                </div>
                <div className="viz-arrow">→</div>
                <div className="viz-node" data-k="points">
                  <span>points</span>
                  <strong id="viz-dag-points">{points}</strong>
                </div>
              </div>
            </div>
            <aside className="tour-explain">
              <h3>Статус</h3>
              <div className="viz-log" id="viz-dag-log">
                —
              </div>
            </aside>
          </div>
        </li>

        <li className="tour-step" data-tour="dsm">
          <div className="tour-step-head">
            <span className="tour-num">3</span>
            <div>
              <h2>Binary DSM</h2>
              <p className="tour-why">
                <code>POST /api/delta</code> отправляет бинарный кадр дельты;
                справа — размер ответа сервера (оценка JSON рядом для сравнения).
              </p>
            </div>
          </div>
          <div className="tour-demo">
            <div className="tour-demo-ui">
              <p className="tour-label">cart после sync</p>
              <p className="tour-big" id="viz-sync-n">
                {cart}
              </p>
              <div className="tour-btns">
                <button onClick={sync_cart} id="btn-sync">
                  Sync → /api/delta
                </button>
              </div>
              <div className="viz-packets" id="viz-packets">
                <div className="viz-packet json" id="viz-pkt-json">
                  JSON estimate —
                </div>
                <div className="viz-packet bin idle" id="viz-pkt-bin">
                  binary response —
                </div>
              </div>
              <p className="tour-hint" id="viz-dsm-ch">
                DSM channel —
              </p>
            </div>
            <aside className="tour-explain">
              <h3>Статус</h3>
              <div className="viz-log" id="viz-dsm-log">
                —
              </div>
            </aside>
          </div>
        </li>

        <li className="tour-step" data-tour="effect">
          <div className="tour-step-head">
            <span className="tour-num">4</span>
            <div>
              <h2>Effect</h2>
              <p className="tour-why">
                Wasm suspend → <code>POST /api/effect</code> → resume.
                Catalog заполняет слот и читает <code>GET /api/catalog</code>;
                Ping пишет реальный RTT в <code>pingMs</code>.
              </p>
            </div>
          </div>
          <div className="tour-demo">
            <div className="tour-demo-ui">
              <p className="tour-label">pipeline</p>
              <div className="viz-timeline" id="viz-timeline" aria-hidden="true">
                <div className="viz-tl-step" data-s="1">
                  click
                </div>
                <div className="viz-tl-step" data-s="2">
                  suspend
                </div>
                <div className="viz-tl-step" data-s="3">
                  /api/effect
                </div>
                <div className="viz-tl-step" data-s="4">
                  resume
                </div>
              </div>
              <div className="tour-btns">
                <button onClick={load_catalog} id="btn-catalog">
                  Catalog
                </button>
                <button onClick={measure_ping} id="btn-ping">
                  Ping RTT
                </button>
              </div>

              <div className="viz-metric-row">
                <div className="viz-metric">
                  <span>catalog</span>
                  <strong id="viz-catalog-n">{catalog}</strong>
                </div>
                <div className="viz-metric">
                  <span>pingMs</span>
                  <strong id="viz-ping-n">{pingMs}</strong>
                  <em>ms</em>
                </div>
              </div>

              <div className="viz-catalog" id="viz-catalog">
                <p className="viz-empty">Catalog → GET /api/catalog</p>
              </div>
              <div className="viz-ping" id="viz-ping">
                <div className="viz-ping-pulse"></div>
                <p id="viz-ping-status">Ping: ещё не измеряли</p>
              </div>
            </div>
            <aside className="tour-explain">
              <h3>Статус</h3>
              <div className="viz-log" id="viz-effect-log">
                —
              </div>
            </aside>
          </div>
        </li>

        <li className="tour-step" data-tour="ssr">
          <div className="tour-step-head">
            <span className="tour-num">5</span>
            <div>
              <h2>SSR hydrate</h2>
              <p className="tour-why">
                Ответ сервера уже содержит HTML с <code>data-aether-nid</code> и
                snapshot; клиент цепляется к узлам без очистки <code>#root</code>.
              </p>
            </div>
          </div>
          <div className="tour-demo">
            <div className="tour-demo-ui">
              <p className="tour-label">проверка</p>
              <pre className="viz-ssr" id="viz-ssr">
                —
              </pre>
            </div>
            <aside className="tour-explain">
              <h3>Статус</h3>
              <div className="viz-log" id="viz-ssr-log">
                —
              </div>
            </aside>
          </div>
        </li>
        <li className="tour-step" data-tour="list">
          <div className="tour-step-head">
            <span className="tour-num">6</span>
            <div>
              <h2>List (map → Loop)</h2>
              <p className="tour-why">
                <code>{"{items.map(...)}"}</code> компилируется в{" "}
                <code>ControlFlow::Loop</code>: длина слота + per-row{" "}
                <code>{"{item}"}</code> → <code>$item</code>. Ниже —{" "}
                <code>{"{showPanel && …}"}</code> → Condition.
              </p>
            </div>
          </div>
          <div className="tour-demo">
            <div className="tour-demo-ui">
              <p className="tour-label">
                items = <strong id="viz-items-n">{items}</strong>
              </p>
              <ul className="viz-list" id="viz-list">
                {items.map((item) => (
                  <li className="viz-list-item">
                    row <strong>{item}</strong>
                  </li>
                ))}
              </ul>
              <div className="tour-btns">
                <button onClick={add_row}>+ row</button>
                <button onClick={remove_row}>− row</button>
              </div>
              {showPanel && (
                <p className="tour-label" id="viz-cond-panel">
                  Condition panel (showPanel)
                </p>
              )}
              <div className="tour-btns">
                <button type="button" id="btn-toggle-panel" onClick={toggle_panel}>
                  toggle panel
                </button>
              </div>
            </div>
            <aside className="tour-explain">
              <h3>Статус</h3>
              <div className="viz-log" id="viz-list-log">
                Loop IR · length slot
              </div>
            </aside>
          </div>
        </li>
      </ol>

      <section className="tour-finale">
        <h2>Дальше</h2>
        <p>
          Полный путь разработчика и матрица синтаксисов — в Guide. Сравнение
          моделей стоимости — на главной.
        </p>
        <p className="tour-finale-links">
          <a className="tour-cta" href="/guide.html">
            Guide
          </a>
          <a href="/#compare">Cost model</a>
          <a href="/api.html">API</a>
        </p>
      </section>
    </div>
  );
}
