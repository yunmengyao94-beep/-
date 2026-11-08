/**
 * 协议弹窗与勾选门（登录 / 注册页共用）
 * ---------------------------------------------------------------------------
 * · bindTermsGate：未勾选时按钮置灰不可点，返回 getter 供提交前二次校验
 * · bindAgreementLinks：点击「《用户协议》/《隐私政策》」弹出 Modal
 *   （完整版仍可通过「查看完整协议」跳转 agreement.html）
 */

import { openModal, closeModal } from '../components/feedback.js';

/** 精简版协议内容（弹窗用） */
const DOCS = {
  terms: {
    title: '用户协议',
    body: `
      <p class="ai-modal__text">
        欢迎使用庆师易校圈。本平台为校园内的闲置物品信用共享提供撮合服务，注册即表示你已年满 16 周岁并同意以下条款：
      </p>
      <p class="ai-modal__text"><strong>一、账号</strong>：须使用本人真实学号注册，账号仅限本人使用，不得转让、出借。</p>
      <p class="ai-modal__text"><strong>二、借用</strong>：借用物品会按物品设定的额度冻结信用分，归还验收后解冻；逾期或损坏按《损坏赔偿明细表》扣分。</p>
      <p class="ai-modal__text"><strong>三、物品</strong>：禁止发布违禁品、假冒伪劣或侵犯他人权益的物品。</p>
      <p class="ai-modal__text"><strong>四、违约</strong>：恶意占用、刷分或利用漏洞的账号将被扣除信用分直至冻结。</p>
    `,
  },
  privacy: {
    title: '隐私政策',
    body: `
      <p class="ai-modal__text">
        我们只收集提供服务所必需的信息，并尽可能在你的设备上完成处理。
      </p>
      <p class="ai-modal__text">
        <strong>一、端侧 OCR</strong>：芝麻信用截图使用内置的 Tesseract.js 引擎
        <strong>完全在你的浏览器本地识别</strong>，图片不上传、不落盘、不经过服务器。
      </p>
      <p class="ai-modal__text">
        <strong>二、我们收集什么</strong>：学号、姓名、学院、楼栋房间号、发布与借用记录；仅用于身份识别与信用记录。
      </p>
      <p class="ai-modal__text">
        <strong>三、我们不收集什么</strong>：不读取通讯录、短信、通话记录、相册全量照片、精确位置；不接入第三方广告或统计 SDK。
      </p>
      <p class="ai-modal__text">
        <strong>四、存储与删除</strong>：数据保存在本机 localStorage；你可在「设置」中清除缓存或退出登录，删除后不可恢复。
      </p>
      <p class="ai-modal__text">
        <strong>五、你的权利</strong>：可随时查看、导出、删除自己的数据，或停止使用本服务。
      </p>
    `,
  },
};

/**
 * 打开协议弹窗
 * @param {'terms'|'privacy'} kind
 */
export function openAgreement(kind) {
  const doc = DOCS[kind] || DOCS.terms;

  const html = [
    doc.body,
    '<div class="ai-modal__actions">',
    '<a class="btn btn--secondary" href="./agreement.html" target="_blank" rel="noopener">查看完整协议</a>',
    '<button class="btn btn--primary" id="doc-close" type="button">我知道了</button>',
    '</div>',
  ].join('');

  const mask = openModal(doc.title, html);
  if (!mask) return;

  const closeBtn = mask.querySelector('#doc-close');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
}

/**
 * 绑定页面里的协议链接
 * @param {Document|HTMLElement} root
 */
export function bindAgreementLinks(root = document) {
  const nodes = root.querySelectorAll ? root.querySelectorAll('[data-doc]') : [];
  nodes.forEach((node) => {
    node.addEventListener('click', (event) => {
      event.preventDefault();
      openAgreement(node.getAttribute('data-doc'));
    });
  });
}

/**
 * 勾选门：未勾选时按钮置灰
 * @param {HTMLInputElement} checkbox
 * @param {HTMLButtonElement} button
 * @returns {() => boolean} 读取是否已勾选
 */
export function bindTermsGate(checkbox, button) {
  if (!checkbox || !button) return () => false;

  const sync = () => {
    button.disabled = !checkbox.checked;
  };

  checkbox.addEventListener('change', sync);
  sync(); // 初始：未勾选 → 置灰

  return () => checkbox.checked;
}

export default { openAgreement, bindAgreementLinks, bindTermsGate };
