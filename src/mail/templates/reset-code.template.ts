/**
 * HTML-письмо с кодом сброса пароля.
 *
 * Почтовые клиенты (особенно Gmail) вырезают <style> и не понимают flex/grid,
 * поэтому вёрстка — таблицами со строго инлайновыми стилями. Картинок нет:
 * логотип набран текстом с градиентом, чтобы письмо не зависело от внешнего хоста
 * (внешние картинки Gmail блокирует до нажатия «показать изображения»).
 */
export function resetCodeTemplate(userName: string, code: string, ttlMin: number): string {
  const digits = code
    .split('')
    .map(
      (d) =>
        `<td style="padding:0 6px;">
           <div style="width:46px;height:60px;line-height:60px;text-align:center;
                       font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                       font-size:30px;font-weight:700;color:#111827;
                       background:#f3f4f6;border:1px solid #e5e7eb;border-radius:10px;">${d}</div>
         </td>`,
    )
    .join('');

  return `<!doctype html>
<html lang="ru">
<body style="margin:0;padding:0;background:#fafafa;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:480px;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">

        <tr><td align="center" style="padding:32px 24px 8px;">
          <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:30px;font-weight:700;
                      background:linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888);
                      -webkit-background-clip:text;-webkit-text-fill-color:transparent;
                      background-clip:text;color:#dc2743;">Instagram</div>
        </td></tr>

        <tr><td align="center" style="padding:8px 32px 0;">
          <h1 style="margin:0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                     font-size:20px;font-weight:600;color:#111827;">Сброс пароля</h1>
          <p style="margin:12px 0 0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                    font-size:15px;line-height:22px;color:#6b7280;">
            Привет, <b style="color:#111827;">${escapeHtml(userName)}</b>! Введите этот код,
            чтобы задать новый пароль.
          </p>
        </td></tr>

        <tr><td align="center" style="padding:28px 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>${digits}</tr></table>
          <p style="margin:18px 0 0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                    font-size:13px;color:#9ca3af;">
            Код действует <b>${ttlMin} минут</b>.
          </p>
        </td></tr>

        <tr><td style="padding:0 32px;"><div style="height:1px;background:#e5e7eb;"></div></td></tr>

        <tr><td align="center" style="padding:20px 32px 32px;">
          <p style="margin:0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                    font-size:12px;line-height:18px;color:#9ca3af;">
            Если вы не запрашивали сброс пароля — просто проигнорируйте это письмо,
            ваш пароль останется прежним.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** userName приходит из БД, но экранируем — письмо не должно стать вектором инъекции. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
