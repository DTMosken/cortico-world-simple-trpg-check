import type { ConsoleClientBundle, ConsolePanelContext } from 'cortico/web/shared/client-panel.ts';
import { SIMPLE_TRPG_CHECK_CONFIG_GROUP, type SimpleTrpgCheckConfigSection } from '../config.ts';

interface ConfigState {
  config: SimpleTrpgCheckConfigSection;
  keySet: boolean;
}

async function mountConfig(ctx: ConsolePanelContext): Promise<void> {
  const { ui } = ctx;
  const options = await ctx.invoke<Array<{ value: string; label: string }>>('options');
  let state = await ctx.invoke<ConfigState>('state');
  let status = '';
  let failed = false;
  render();
  ctx.interval(() => {
    void ctx.invoke<ConfigState>('state').then((next) => {
      if (JSON.stringify(next) !== JSON.stringify(state)) {
        state = next;
        render();
      }
    }).catch(() => undefined);
  }, 2_000);

  async function save(key: keyof SimpleTrpgCheckConfigSection, value: string | number | boolean): Promise<void> {
    try {
      state = await ctx.invoke<ConfigState>('save', [key, value]);
      status = '已保存';
      failed = false;
    } catch (error) {
      status = `保存失败：${error instanceof Error ? error.message : String(error)}`;
      failed = true;
    }
    render();
    void ctx.refresh().catch(() => undefined);
  }

  function render(): void {
    const sheet = ui.sheet({ title: '配置' });
    const fields = ui.h('div');
    const config = state.config;
    for (const [path, property] of Object.entries(SIMPLE_TRPG_CHECK_CONFIG_GROUP.schema.properties)) {
      const key = path.split('.').at(-1) as keyof SimpleTrpgCheckConfigSection;
      const value = config[key];
      let field: HTMLElement;
      if (property.type === 'boolean') {
        field = ui.checkbox(property.title, {
          checked: Boolean(value), onChange: (next) => { void save(key, next); },
        }).el;
      } else if (property.enum || property['x-options']) {
        const choices = property.enum ?? options.map((item) => item.value);
        const entries = choices.map((choice) => ({
          value: choice,
          label: property['x-options'] ? options.find((item) => item.value === choice)?.label ?? choice : choice,
        }));
        if (!entries.some((item) => item.value === value)) entries.unshift({ value: String(value), label: String(value) });
        field = ui.field(property.title, ui.select({
          value: String(value), options: entries, onChange: (next) => { void save(key, next); },
        }));
      } else {
        field = ui.field(property.title, ui.input({
          type: property.type === 'integer' ? 'number' : 'text',
          value: String(value),
          onChange: (next) => { void save(key, property.type === 'integer' ? Number(next) : next); },
        }));
      }
      fields.appendChild(field);
      if (property.description) fields.appendChild(ui.msgline(property.description));
    }
    sheet.body.appendChild(fields);

    if (config.backend === 'jev') {
      const sourceName = config.jevSource === 'openrouter' ? 'OpenRouter' : 'TypeSafe';
      const keyStatus = ui.msgline(state.keySet ? '密钥已配置' : '密钥未配置');
      const open = ui.button(`打开 ${sourceName} 密钥文件`, {
        onClick: () => {
          open.disabled = true;
          void ctx.invoke<{ file: string }>('openKeyFile', [config.jevSource]).then(({ file }) => {
            keyStatus.textContent = `已打开 ${file}`;
          }).catch((error) => {
            keyStatus.textContent = `打开失败：${error instanceof Error ? error.message : String(error)}`;
            keyStatus.classList.add('bad');
          }).finally(() => { open.disabled = false; });
        },
      });
      const keyActions = ui.actions();
      keyActions.append(keyStatus, open);
      sheet.body.appendChild(keyActions);
    }

    const result = ui.msgline(status, failed);
    const test = ui.button('测试连接', {
      onClick: () => {
        test.disabled = true;
        result.textContent = '测试中…';
        result.classList.remove('bad');
        void ctx.invoke<{ ok: boolean; error?: string }>('testConnection').then((out) => {
          result.textContent = out.ok ? '连接成功' : `连接失败：${out.error || '模型没有返回有效结果'}`;
          result.classList.toggle('bad', !out.ok);
          void ctx.refresh().catch(() => undefined);
        }).catch((error) => {
          result.textContent = `连接失败：${error instanceof Error ? error.message : String(error)}`;
          result.classList.add('bad');
        }).finally(() => { test.disabled = false; });
      },
    });
    const actions = ui.actions();
    actions.append(result, test);
    sheet.body.appendChild(actions);
    ctx.root.replaceChildren(sheet.el);
  }
}

const client: ConsoleClientBundle = { panels: { config: { mount: mountConfig } } };
export default client;
