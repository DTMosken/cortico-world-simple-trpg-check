import type { ConsoleClientBundle, ConsolePanelContext } from 'cortico/web/shared/client-panel.ts';

interface KeyState {
  backend: string;
  source: 'typesafe' | 'openrouter';
  keySet: boolean;
}

async function mountCredentials(ctx: ConsolePanelContext): Promise<void> {
  let state = await ctx.invoke<KeyState>('state');
  render(state);
  ctx.interval(() => {
    void ctx.invoke<KeyState>('state').then((next) => {
      if (next.backend !== state.backend || next.source !== state.source) {
        state = next;
        render(next);
      }
    }).catch(() => undefined);
  }, 2_000);

  function render(current: KeyState): void {
    const { ui } = ctx;
    const card = ui.sheet({ title: 'Jev 密钥' });
    if (current.backend !== 'jev') {
      card.body.appendChild(ui.msgline('当前判定模型未选择 Jev。'));
      ctx.root.replaceChildren(card.el);
      return;
    }
    const sourceName = current.source === 'openrouter' ? 'OpenRouter' : 'TypeSafe';
    const key = ui.input({ type: 'password', placeholder: current.keySet ? '已配置；留空不更改' : 'API key' });
    const message = ui.msgline(current.keySet ? '密钥已配置' : '密钥未配置');
    const save = ui.button(`保存 ${sourceName} 密钥`, {
      variant: 'primary',
      onClick: () => { void saveKey(ctx, current.source, key, message, save); },
    });
    const actions = ui.actions();
    actions.append(message, save);
    card.body.append(ui.field(`${sourceName} API key`, key), actions);
    ctx.root.replaceChildren(card.el);
  }
}

async function saveKey(
  ctx: ConsolePanelContext,
  source: KeyState['source'],
  key: HTMLInputElement,
  message: HTMLDivElement,
  save: HTMLButtonElement,
): Promise<void> {
  if (!key.value.trim()) {
    message.textContent = 'API key 不能为空';
    message.classList.add('bad');
    return;
  }
  save.disabled = true;
  try {
    await ctx.invoke('saveKey', [source, key.value]);
    key.value = '';
    message.textContent = '密钥已保存';
    message.classList.remove('bad');
    await ctx.refresh();
  } catch (error) {
    message.textContent = `保存失败：${error instanceof Error ? error.message : String(error)}`;
    message.classList.add('bad');
  } finally {
    save.disabled = false;
  }
}

const client: ConsoleClientBundle = {
  panels: { credentials: { mount: mountCredentials } },
};

export default client;
