/* SPDX-License-Identifier: GPL-2.0-only · Original Brclio Edge interface */
'use strict';
const form = document.getElementById('login-form');
const password = document.getElementById('password');
const reveal = document.getElementById('show-password');
const errorPanel = document.getElementById('login-error');
const submit = document.getElementById('login-submit');
reveal.addEventListener('click', () => {
  const show = password.type === 'password'; password.type = show ? 'text' : 'password';
  reveal.textContent = show ? '隐藏' : '显示'; reveal.setAttribute('aria-label', show ? '隐藏密码' : '显示密码'); reveal.setAttribute('aria-pressed', String(show));
});
form.addEventListener('submit', async (event) => {
  event.preventDefault(); if (!form.reportValidity()) return;
  errorPanel.hidden = true; submit.disabled = true; password.disabled = true; submit.textContent = '正在验证…';
  try {
    const response = await fetch('/login', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(20000) : undefined, headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ password: password.value }) });
    let result;
    try { result = await response.json(); } catch { throw new Error('服务暂时没有返回有效结果，请稍后重试。'); }
    if (!response.ok || result.success !== true) throw new Error(response.status === 401 ? '密码不正确，请检查后重试。' : result.error || result.message || '暂时无法登录，请稍后重试。');
    password.value = ''; submit.textContent = '登录成功，正在进入…'; location.replace('/admin');
  } catch (error) {
    errorPanel.textContent = error.name === 'TimeoutError' ? '验证超过 20 秒，请稍后重试。' : error instanceof TypeError ? '网络连接失败，请检查网络后重试。' : error.message;
    errorPanel.hidden = false; password.disabled = false; submit.disabled = false; submit.textContent = '进入工作空间 →'; password.focus(); password.select();
  }
});
