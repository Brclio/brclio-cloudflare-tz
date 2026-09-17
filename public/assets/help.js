/* SPDX-License-Identifier: GPL-2.0-only · Original Brclio Edge configuration help */
'use strict';

(() => {
  if (document.getElementById('configuration-help-dialog')) return;
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  // These examples intentionally contain no live credentials or probe targets.
  const topics = {
    token: {
      title: '订阅 TOKEN：谁能读取你的订阅',
      label: '订阅 TOKEN',
      intro: '订阅 URL 中的 token 用来校验订阅读取权限。它与后台登录密码、节点 UUID 各有用途。',
      sections: [
        { title: '保留完整的订阅地址', paragraphs: ['复制「订阅与节点链接」中生成的完整 HTTPS 地址，连同 ?token= 后的内容一起导入客户端。单节点的 vless://、trojan://、ss:// 链接应放在客户端的分享链接导入入口。', '本项目根据订阅入口主机名和 UUID 计算 TOKEN。更换订阅域名或 UUID 后，请重新复制后台生成的地址。TOKEN 是计算结果，直接修改主配置 JSON 中的 TOKEN 不会改变服务端鉴权。'] },
        { title: '怎样让旧地址失效', paragraphs: ['在 Cloudflare 中修改 UUID 并重新部署，会改变对应入口的 TOKEN；随后重新获取节点链接与订阅地址。未设置有效 UUID v4 时，系统会根据管理密码和 KEY 派生 UUID，因此修改这些变量也可能改变订阅。', '设置了有效的 UUID 环境变量后，UUID 不随 ADMIN / KEY 改变；在入口主机名也不变时，修改后台密码本身不会更换订阅 TOKEN。'] },
        { title: '分享时保留边界', paragraphs: ['订阅地址可用于获取包含节点访问凭据的配置。请仅分享给你信任的人；帮助页不会展示、复制或发送你当前的 TOKEN。'] },
      ],
    },
    uuid: {
      title: 'UUID：节点身份从哪里来',
      label: 'UUID',
      intro: '节点 UUID 由运行环境决定。后台中的 UUID 用于查看和复制，不能通过编辑主配置覆盖。',
      sections: [
        { title: '固定自己的 UUID', steps: ['在 Cloudflare 对应的 Worker / Pages 项目中添加 UUID 环境变量，填写有效的 UUID v4。', '保存变量，并按 Cloudflare 的要求重新部署；Pages 要检查生产环境与预览环境是否配置正确。', '重新登录后台核对 UUID，再重新复制节点链接和订阅地址，更新客户端。'] },
        { title: '未设置时的派生规则', paragraphs: ['没有有效 UUID v4 时，程序使用管理密码与 KEY 派生 UUID。修改这些变量后，派生值可能改变。固定有效 UUID 后，管理密码与节点身份可分别调整。', 'UUID、ADMIN 和订阅 TOKEN 不能相互替换：ADMIN 用于登录后台，UUID 用于节点身份，TOKEN 用于订阅鉴权。'] },
        { title: '示例只是格式', code: '00000000-0000-4000-8000-000000000000', paragraphs: ['上面的全零示例仅说明 UUID v4 的形状。请使用自己生成的随机 UUID，不要把帮助示例作为真实访问凭据。'] },
      ],
    },
    addresses: {
      title: '自定义地址：从一行到一份订阅',
      label: '自定义地址',
      intro: 'ADD.txt 每行填写一个入口地址或受支持的来源。地址列表与主配置分别保存。',
      sections: [
        { title: '普通地址格式', code: 'edge.example.com:443#我的入口\n192.0.2.10:8443#IPv4 示例\n[2001:db8::10]:2053#IPv6 示例', paragraphs: ['格式为 地址:端口#备注。IPv6 带端口时加方括号，备注可以省略。未填写端口时通常使用 443；应以客户端和当前 TLS 设置支持的端口为准。', '以上域名与 IP 均为文档示例，不是可用优选节点。请替换为你实际测试过的地址。'] },
        { title: '接口、生成器与已有节点', code: 'https://addresses.example.com/list.txt\nsub://generator.example.com#我的生成器\nvless://…', paragraphs: ['也可使用你自己的地址接口、订阅来源或完整节点分享链接。通过「优选接口与订阅汇聚」验证后，可选择追加接口 URL，或追加本次返回的静态结果。两者的更新方式不同：接口行会在生成订阅时读取，静态地址保留本次结果。', '通过「链式代理节点」工具，可以为单个入口生成带上游代理指令的备注。请使用工具生成的完整行，避免手工漏掉凭据或路径编码。'] },
        { title: '让列表真正生效', steps: ['订阅来源选择「本地地址库」，关闭「随机 IP」。', '填写或追加地址后点击「保存地址列表」。', '点击顶部「保存配置」保存来源与随机 IP 选项。', '在客户端更新订阅，确认出现新地址。'] },
      ],
    },
    ech: {
      title: 'ECH：DNS、SNI 与客户端要配合',
      label: 'ECH',
      intro: 'ECH 用于加密 TLS ClientHello 的部分内容。开启选项会影响节点与订阅参数，实际连接仍取决于客户端、解析结果和服务端支持。',
      sections: [
        { title: '两个字段分别做什么', items: ['ECH DNS：获取 ECH 配置信息使用的解析服务。可使用字段中的预设，也可输入自己的解析地址；https:// 与 udp:// 格式是否可用，取决于所选客户端与订阅格式。', 'ECH SNI：用于获取 ECH 配置的域名。它与节点入口域名用途不同，不是 ProxyIP 或上游代理地址。不同客户端格式对空值的处理可能不同，需要固定行为时请明确填写支持 ECH 的域名。'] },
        { title: '先满足连接条件', items: ['客户端及其 TLS 实现必须支持 ECH。使用 chrome 或 firefox 指纹；不兼容指纹会触发面板中的冲突处理。', 'Shadowsocks 关闭 TLS 时不能启用 ECH 或 TLS 分片。先开启 TLS，再调整这些选项。', 'ECH 不替代证书验证。ALPN 留空可由客户端自动协商；TLS 分片仍需对应客户端支持。'] },
        { title: '修改后的验证顺序', steps: ['在进阶配置中填写 ECH DNS / SNI，开启 ECH 并保存主配置。', '重新生成或更新适合客户端的订阅，检查客户端是否保留 ECH 参数。', '实际连接并查看客户端日志。若失败，逐项检查解析服务、SNI、指纹及 TLS 支持，避免同时改动多个条件。'] },
      ],
    },
    proxy: {
      title: '入口、反代与上游代理',
      label: '代理路由',
      intro: '先区分客户端连接到哪里，再决定 Worker 怎样访问目标。更换优选入口，不等于更换所有目标看到的出口。',
      sections: [
        { title: '入口负责到达 Worker', flow: ['客户端', '节点域名 / 优选地址', 'Cloudflare Worker', '目标服务'], paragraphs: ['HOST / HOSTS、TLS SNI 与路径属于节点入口参数；优选地址影响客户端到 Cloudflare 的连接。能够直接连接目标时，Worker 可以走直连。实际出口由 Cloudflare 的路由与目标情况决定。'] },
        { title: 'PROXYIP 作为反代出口', flow: ['客户端', 'Cloudflare Worker', 'PROXYIP', '目标服务'], paragraphs: ['PROXYIP 为需要反代或直连失败的场景提供出口；它不是订阅转换后端，也不是 Cloudflare Account ID。auto 使用程序的自动反代选择，也可填写你自己的地址与端口。', 'Cloudflare TCP Sockets 对部分目标有限制。目标无法直连时，需要可用的反代或上游代理；选到了某个地区的入口，并不能保证所有请求都从该地区离开。'] },
        { title: '上游代理与域名白名单', items: ['可配置 SOCKS5、HTTP、HTTPS、TURN 或 SSTP 上游代理，地址与账号格式以服务提供方为准。', '关闭「全局使用上游代理」时，域名白名单决定哪些目标使用上游代理；开启全局时扩大到全部目标。保存后的白名单对 WS / gRPC / XHTTP 请求生效，GO2SOCKS5 环境变量仍会附加匹配项。', '路径模板决定代理指令怎样进入节点路径。修改出口或路径模板后，保存主配置并重新获取节点链接，客户端不会自动采用未更新的旧链接。'], links: [['Cloudflare TCP Sockets 文档', 'https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/']] },
      ],
    },
    usage: {
      title: 'Workers / Pages 用量接入',
      label: '请求用量',
      intro: '请求使用情况来自你的 Cloudflare 账户或自定义 UsageAPI。它统计的是请求次数，不是隧道字节数或实时网速。',
      sections: [
        { title: '三种方式选择一种', items: ['Account ID + API Token：为对应账户创建 API Token，配置 Account → Account Analytics → Read 权限，并将资源范围限定到要查询的账户。', '账户邮箱 + Global API Key：使用同一账户的邮箱与密钥；如果需要明确指定某一账户，使用 Account ID + API Token 更直接。', '自定义 UsageAPI：填写你自己的 HTTPS 接口，可通过 UsagePanel 汇总多个账户。接口应返回 success: true，以及数字 workers、pages、total、max；total 等于 workers + pages，max 为日配额。'], links: [['UsagePanel 多账户用量项目', 'https://github.com/cmliu/CF-Workers-UsagePanel'], ['Cloudflare API Token 创建说明', 'https://developers.cloudflare.com/fundamentals/api/get-started/create-token/']] },
        { title: '验证、保存与刷新', paragraphs: ['在设置中选择认证方式并填写凭据，先点「验证输入（不保存）」检查查询是否可用，再保存用量配置。修改输入后，请重新验证。', '查询由当前 Worker 发出；浏览器不会把凭据拼入查询 URL。保存后可在概览或设置刷新用量。不要将 Cloudflare API Token 与订阅 TOKEN 混用。'] },
        { title: '怎样理解每日配额', paragraphs: ['直接查询 Cloudflare 时，页面按 Workers 免费计划每日 100,000 次作参考；它不是自动读取的套餐账单。付费套餐、实际额度及统计延迟请以 Cloudflare 控制台为准。自定义 UsageAPI 使用返回的 max，可提供多账户合计配额。', 'UTC 00:00 对应北京时间（UTC+8）08:00。倒计时只更新本地显示，不会自动把服务端实际使用量清零。新的统计日需要查询新数据，失败或未接入不能当作使用量为零。'], links: [['Cloudflare Workers 配额说明', 'https://developers.cloudflare.com/workers/platform/limits/']] },
      ],
    },
  };

  const dialog = make('dialog', 'confirm-dialog help-dialog');
  dialog.id = 'configuration-help-dialog';
  dialog.setAttribute('aria-labelledby', 'configuration-help-title');
  dialog.setAttribute('aria-describedby', 'configuration-help-intro');
  const header = make('div', 'help-dialog-header');
  const heading = make('div'); heading.append(make('span', 'small-caps', 'CONFIGURATION GUIDE'));
  const title = make('h2'); title.id = 'configuration-help-title'; heading.append(title);
  const close = make('button', 'button button-small help-close', '关闭'); close.type = 'button'; close.setAttribute('aria-label', '关闭配置帮助');
  close.addEventListener('click', () => dialog.close());
  header.append(heading, close);
  const intro = make('p', 'help-intro'); intro.id = 'configuration-help-intro';
  const nav = make('nav', 'help-directory'); nav.setAttribute('aria-label', '配置帮助目录');
  const content = make('div', 'help-content'); content.tabIndex = -1;
  let returnTopic = 'token', returnFocus = null;

  function selectTopic(key) {
    const topic = topics[key]; if (!topic) return;
    title.textContent = topic.title; intro.textContent = topic.intro;
    for (const button of nav.querySelectorAll('button')) {
      if (button.dataset.helpNav === key) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    content.replaceChildren();
    for (const entry of topic.sections) {
      const section = make('section', 'help-section'); section.append(make('h3', '', entry.title));
      if (entry.flow) {
        const flow = make('ol', 'help-route'); flow.setAttribute('aria-label', entry.flow.join('，然后'));
        for (const label of entry.flow) flow.append(make('li', '', label));
        section.append(flow);
      }
      if (entry.code) section.append(make('pre', 'help-example', entry.code));
      for (const text of entry.paragraphs || []) section.append(make('p', '', text));
      if (entry.items || entry.steps) {
        const list = make(entry.steps ? 'ol' : 'ul', entry.steps ? 'help-steps' : 'explanation-list');
        for (const text of entry.steps || entry.items) list.append(make('li', '', text));
        section.append(list);
      }
      if (entry.links) {
        const links = make('div', 'tool-actions');
        for (const [label, href] of entry.links) {
          const link = make('a', 'text-link', label + ' ↗');
          link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; links.append(link);
        }
        section.append(links);
      }
      content.append(section);
    }
    content.scrollTop = 0;
  }
  for (const [key, topic] of Object.entries(topics)) {
    const button = make('button', 'button button-small', topic.label); button.type = 'button'; button.dataset.helpNav = key;
    button.addEventListener('click', () => { selectTopic(key); content.focus({ preventScroll: true }); }); nav.append(button);
  }
  dialog.append(header, intro, nav, content); document.body.append(dialog);
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    const trigger = returnFocus?.isConnected ? returnFocus : document.querySelector('[data-help-topic="' + returnTopic + '"]');
    trigger?.focus({ preventScroll: true }); returnFocus = null;
  });

  function mount(container, key, label) {
    if (!container || container.querySelector('[data-help-topic="' + key + '"]')) return;
    const button = make('button', 'button button-small help-entry', label); button.type = 'button';
    button.dataset.helpTopic = key; button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-controls', dialog.id);
    button.addEventListener('click', () => { returnFocus = button; returnTopic = key; selectTopic(key); if (!dialog.open) dialog.showModal(); close.focus(); });
    container.append(button);
  }
  function fieldWithLabel(containerID, label) {
    const container = document.getElementById(containerID);
    return Array.from(container?.querySelectorAll('.field') || []).find((field) => field.querySelector('.field-label')?.childNodes[0]?.textContent.trim() === label);
  }
  function mountEntries() {
    mount(document.querySelector('#page-subscriptions .subscription-footer'), 'token', '订阅 TOKEN 说明');
    mount(fieldWithLabel('node-identity-fields', '用户 UUID'), 'uuid', 'UUID 如何修改');
    mount(document.getElementById('custom-addresses')?.closest('section'), 'addresses', '地址填写说明');
    mount(fieldWithLabel('node-security-fields', 'ECH'), 'ech', 'ECH 配置帮助');
    mount(document.getElementById('routing-fields')?.parentElement, 'proxy', '入口与代理怎么区分');
    mount(document.getElementById('cf-form'), 'usage', '用量凭据与多账户说明');
  }
  mountEntries();
  window.addEventListener('brclio:config', mountEntries);
  // Configuration import/save can replace these grids without a page navigation.
  const observer = new MutationObserver(mountEntries);
  for (const id of ['node-identity-fields', 'node-security-fields']) {
    const container = document.getElementById(id); if (container) observer.observe(container, { childList: true });
  }
})();
