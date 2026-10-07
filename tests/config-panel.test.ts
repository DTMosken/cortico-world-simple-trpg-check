import { expect, it } from 'vitest';
import { OPENROUTER_LUNA_MODEL, SIMPLE_TRPG_CHECK_DEFAULTS } from '../src/config.ts';

const JSDOM_MODULE = new URL('../../Cortico/node_modules/jsdom/lib/api.js', import.meta.url).href;
const UI_MODULE = '../../Cortico/src/web/client/ui/index.ts';
const CLIENT_MODULE = '../src/console/client.ts';
const { JSDOM } = await import(JSDOM_MODULE) as {
  JSDOM: new (html: string, options: { url: string }) => {
    window: { document: any; AbortController: typeof AbortController };
  };
};
const { createConsoleUi } = await import(UI_MODULE);
const { default: client } = await import(CLIENT_MODULE);

it('places the test first and shows only settings for the selected model', async () => {
  const { window } = new JSDOM('<!doctype html><body><div id="root"></div></body>', { url: 'http://localhost' });
  const controller = new window.AbortController();
  const config = { ...SIMPLE_TRPG_CHECK_DEFAULTS };
  const root = window.document.getElementById('root')!;
  const ui = createConsoleUi({
    doc: window.document, overlayHost: window.document.body, signal: controller.signal,
    memo: { get: <T>(_key: string, fallback: T): T => fallback, set: () => {} },
  });
  let poll: () => void = () => {};
  await client.panels.config.mount({
    root, ui, signal: controller.signal,
    invoke: async (method: string) => {
      if (method === 'options') return [];
      if (method === 'state') return { config: { ...config }, keySet: false };
      throw new Error(method);
    },
    interval: (callback: () => void) => { poll = callback; return { dispose() {} }; },
    refresh: async () => {},
  } as never);
  expect(root.textContent!.indexOf('测试连接')).toBeLessThan(root.textContent!.indexOf('判定方式'));
  expect(root.textContent).toContain('Laya 空闲释放时间');
  expect(root.textContent).not.toContain('决策服务');
  config.backend = 'jev';
  poll();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(root.textContent).toContain('决策服务');
  expect(root.textContent).toContain('密钥未配置');
  expect(root.textContent).not.toContain('Laya 空闲释放时间');
  expect(root.textContent).not.toContain('自定义决策服务地址');
  config.jevSource = 'custom';
  poll();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(root.textContent).toContain('自定义决策服务地址');
  expect(root.textContent).toContain('打开 自定义服务 密钥文件');
});

it('saves preset and custom model IDs while retaining the service key', async () => {
  const { window } = new JSDOM('<!doctype html><body><div id="root"></div></body>', { url: 'http://localhost' });
  const controller = new window.AbortController();
  const config = { ...SIMPLE_TRPG_CHECK_DEFAULTS, backend: 'jev' as const, jevSource: 'openrouter' as const };
  const root = window.document.getElementById('root')!;
  const ui = createConsoleUi({ doc: window.document, overlayHost: window.document.body, signal: controller.signal,
    memo: { get: <T>(_key: string, fallback: T): T => fallback, set() {} } });
  await client.panels.config.mount({ root, ui, signal: controller.signal,
    invoke: async (method: string, args: unknown[]) => {
      if (method === 'options') return [];
      if (method === 'save') {
        if (args[0] !== 'jevModel' || typeof args[1] !== 'string') throw new Error('unexpected setting');
        config.jevModel = args[1];
      }
      return { config: { ...config }, keySet: true };
    }, interval: () => ({ dispose() {} }), refresh: async () => {},
  } as never);
  expect([...root.querySelectorAll('datalist option')].map((option: any) => option.value)).toContain(OPENROUTER_LUNA_MODEL);
  for (const model of [OPENROUTER_LUNA_MODEL, 'decision/fast']) {
    const input = root.querySelector('input[list="trpg-decision-models"]');
    input.value = model; input.dispatchEvent(new (window as any).Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(config.jevModel).toBe(model);
    expect(root.querySelector('input[list="trpg-decision-models"]').value).toBe(model);
    expect(root.textContent).toContain('未校准');
    expect(root.textContent).toContain('密钥已配置');
    expect(root.textContent).toContain('打开 OpenRouter 密钥文件');
  }
  controller.abort();
});
