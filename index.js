const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json());

app.post("/agendar", async (req, res) => {
  const { nome, telefone, dataBR, horaCalendly } = req.body;

  let horaInicioWebDiet = horaCalendly;
  let horaFimWebDiet;

  if (horaCalendly === "09:00") {
    horaInicioWebDiet = "09:10";
    horaFimWebDiet = "10:00";
  } else if (horaCalendly === "13:00") {
    horaInicioWebDiet = "13:10";
    horaFimWebDiet = "14:00";
  } else if (horaCalendly === "18:00") {
    horaInicioWebDiet = "18:10";
    horaFimWebDiet = "19:00";
  } else {
    const [h, m] = horaCalendly.split(":").map(Number);
    const fim = new Date();
    fim.setHours(h);
    fim.setMinutes(m + 60);
    horaFimWebDiet = `${String(fim.getHours()).padStart(2, "0")}:${String(fim.getMinutes()).padStart(2, "0")}`;
  }

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage();

  try {
    await page.goto("https://pt.webdiet.com.br/login/", { waitUntil: "domcontentloaded" });
    await page.fill('input[placeholder*="email"]', process.env.WEBDIET_EMAIL);
    await page.fill('input[placeholder*="senha"]', process.env.WEBDIET_SENHA);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(8000);

    await page.goto("https://pt.webdiet.com.br/painel/v4/novaAgenda.php?p=", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);

    let achou = false;
    let tentativas = 0;
    while (!achou && tentativas < 8) {
      const texto = await page.locator("body").innerText();
      if (texto.includes(dataBR)) { achou = true; break; }
      await page.locator(".fc-next-button").click();
      await page.waitForTimeout(3000);
      tentativas++;
    }

    if (!achou) {
      await browser.close();
      return res.json({ status: "semana_nao_encontrada", dataBR });
    }

    const headers = await page.locator(".fc-col-header-cell").evaluateAll(els =>
      els.map(el => { const r = el.getBoundingClientRect(); return { texto: el.innerText, x: r.x, width: r.width }; })
    );
    const header = headers.find(h => h.texto.includes(dataBR));

    const [hh, mm] = horaCalendly.split(":").map(Number);

    // CORREÇÃO DO BUG DAS 20h — usa seletor real do FullCalendar
    const slotHandle = await page.locator(
      `.fc-timegrid-slot[data-time="${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00"]`
    ).first();
    const slotBox = await slotHandle.boundingBox();
    const clickY = slotBox.y + slotBox.height / 2;

    const pontosX = [
      header.x + header.width / 2,
      header.x + header.width * 0.35,
      header.x + header.width * 0.65
    ];

    let modalAbriu = false;
    for (const clickX of pontosX) {
      await page.mouse.click(clickX, clickY);
      await page.waitForTimeout(2500);
      modalAbriu = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll("input")).filter(i => i.offsetParent !== null && i.id !== "inputChat");
        return inputs.length >= 6;
      });
      if (modalAbriu) break;
    }

    if (!modalAbriu) {
      await browser.close();
      return res.json({ status: "modal_nao_abriu", dataBR, horaCalendly });
    }

    const campos = page.locator('input:visible:not(#inputChat)');
    await campos.nth(0).fill(nome);
    await campos.nth(1).fill(telefone);
    await campos.nth(4).fill(horaInicioWebDiet);
    await campos.nth(5).fill(horaFimWebDiet);
    await page.waitForTimeout(1000);

    await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll("select"));
      const selectDDI = selects.find(s => Array.from(s.options).some(o => o.value === "55" || o.textContent.includes("Brasil")));
      if (selectDDI) {
        selectDDI.value = "55";
        selectDDI.dispatchEvent(new Event("input", { bubbles: true }));
        selectDDI.dispatchEvent(new Event("change", { bubbles: true }));
        if (window.jQuery) window.jQuery(selectDDI).val("55").trigger("change");
      }
    });

    await page.waitForTimeout(1500);
    await page.locator("#agendarBtnAtalho").click();
    await page.waitForTimeout(8000);

    await browser.close();
    return res.json({ status: "agendamento_criado", nome, dataBR, horaInicioWebDiet, horaFimWebDiet });

  } catch (err) {
    await browser.close();
    return res.status(500).json({ status: "erro", mensagem: err.message });
  }
});

app.get("/", (req, res) => res.send("WebDiet Automation rodando!"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
