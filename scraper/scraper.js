"use strict";

const express = require("express");
const cron = require("node-cron");
const axios = require("axios");
const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

chromium.use(StealthPlugin());

const API_BASE       = process.env.API_BASE       || "http://api:8000";
const SCRAPER_SECRET = process.env.SCRAPER_SECRET || "scraper-secret-key";

const INSTAGRAM_HESAP = "iyilikdernegi";
const FACEBOOK_HESAP  = "iyilikdernegi";
const X_HESAP         = "iyilikdernegi";
const YOUTUBE_HANDLE  = "iyilikdernegi";

const ISTEK_HEADERS = { "x-scraper-secret": SCRAPER_SECRET };

function suankiAy() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function log(m) { console.log(`[${new Date().toISOString()}] ${m}`); }

async function apiyeKaydet(endpoint, veri) {
  try {
    await axios.post(`${API_BASE}${endpoint}`, veri, { headers: ISTEK_HEADERS });
    log(`✓ Kaydedildi: ${endpoint}`);
  } catch (e) {
    log(`✗ Kayıt hatası (${endpoint}): ${e.message}`);
  }
}

function sayiCoz(metin) {
  if (!metin) return null;
  // "12.5K" → 12500, "1,234" → 1234 gibi
  const temiz = String(metin).replace(/\s/g, "");
  if (/K$/i.test(temiz)) return Math.round(parseFloat(temiz) * 1000);
  if (/M$/i.test(temiz)) return Math.round(parseFloat(temiz) * 1000000);
  const sayi = parseInt(temiz.replace(/[.,]/g, ""));
  return isNaN(sayi) ? null : sayi;
}

// ─── YouTube (public sayfa scraping) ─────────────────────────────
async function youtubeVeriAl(browser) {
  const ay = suankiAy();
  log("YouTube taranıyor (public)...");
  const sayfa = await browser.newPage();
  try {
    await sayfa.setExtraHTTPHeaders({
      "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    });

    // Kanal ana sayfası → abone sayısı
    await sayfa.goto(`https://www.youtube.com/@${YOUTUBE_HANDLE}`, { waitUntil: "networkidle", timeout: 30000 });
    await sayfa.waitForTimeout(3000);
    const metin = await sayfa.textContent("body").catch(() => "");
    const eslAbone = metin.match(/([\d,.]+[KMB]?)\s*abone/i) || metin.match(/([\d,.]+[KMB]?)\s*subscriber/i);
    const takipci  = eslAbone ? sayiCoz(eslAbone[1]) : null;

    // Videolar sekmesi → son videolar
    await sayfa.goto(`https://www.youtube.com/@${YOUTUBE_HANDLE}/videos`, { waitUntil: "networkidle", timeout: 30000 });
    await sayfa.waitForTimeout(3000);

    const videoElemanlar = await sayfa.$$("ytd-rich-item-renderer, ytd-grid-video-renderer").catch(() => []);
    const icerikler = [];

    for (const el of videoElemanlar.slice(0, 15)) {
      try {
        const baslik = await el.$eval("#video-title", (e) => e.textContent?.trim()).catch(() => "");
        const url    = await el.$eval("#video-title", (e) => e.href).catch(() => null);
        const meta   = await el.$eval("#metadata-line, .ytd-video-meta-block", (e) => e.textContent).catch(() => "");
        // Görüntülenme sayısı meta içinde: "1,2B görüntülenme"
        const gEsl   = meta.match(/([\d,.]+[KMB]?)\s*(görüntülenme|view)/i);
        const goruntuleme = gEsl ? sayiCoz(gEsl[1]) || 0 : 0;
        if (baslik) {
          icerikler.push({
            icerik_id:   url?.split("v=")[1] || `yt-${Date.now()}`,
            baslik,
            url:         url || `https://www.youtube.com/@${YOUTUBE_HANDLE}`,
            begeni:      0, yorum: 0, paylasim: 0, goruntuleme,
            tarih:       null,
          });
        }
      } catch (_) {}
    }

    const toplamEtkilesim = icerikler.reduce((t, ic) => t + ic.goruntuleme, 0);
    await apiyeKaydet("/api/scraper/istatistik", {
      platform: "youtube", ay, takipci, etkilesim: toplamEtkilesim, icerik_sayisi: icerikler.length,
    });
    await apiyeKaydet("/api/scraper/icerikler", { platform: "youtube", ay, icerikler });
    log(`YouTube: ${takipci} abone, ${icerikler.length} video`);
  } catch (e) {
    log(`YouTube hatası: ${e.message}`);
  } finally {
    await sayfa.close();
  }
}

// ─── Instagram (login gerektirmez — public meta) ──────────────────
async function instagramVeriAl(browser) {
  const ay = suankiAy();
  log("Instagram taranıyor (public)...");
  const sayfa = await browser.newPage();
  try {
    await sayfa.setExtraHTTPHeaders({
      "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    });

    // Önce public API endpoint dene
    let takipci = null;
    try {
      const apiRes = await sayfa.goto(
        `https://www.instagram.com/api/v1/users/web_profile_info/?username=${INSTAGRAM_HESAP}`,
        { waitUntil: "domcontentloaded", timeout: 15000 }
      );
      const json = await apiRes.json().catch(() => null);
      takipci = json?.data?.user?.edge_followed_by?.count ?? null;
    } catch (_) {}

    // Fallback: profil sayfasının meta description'ından al
    if (takipci === null) {
      await sayfa.goto(`https://www.instagram.com/${INSTAGRAM_HESAP}/`, { timeout: 25000 });
      await sayfa.waitForTimeout(2500);
      const desc = await sayfa.$eval('meta[name="description"], meta[property="og:description"]',
        (el) => el.content).catch(() => "");
      const esl  = desc.match(/([\d,.]+[KMB]?)\s*(Followers|Takipçi)/i);
      if (esl) takipci = sayiCoz(esl[1]);
    }

    await apiyeKaydet("/api/scraper/istatistik", {
      platform: "instagram", ay, takipci, etkilesim: null, icerik_sayisi: null,
    });
    await apiyeKaydet("/api/scraper/icerikler", { platform: "instagram", ay, icerikler: [] });
    log(`Instagram: ${takipci} takipçi (public, etkileşim login gerektirir)`);
  } catch (e) {
    log(`Instagram hatası: ${e.message}`);
  } finally {
    await sayfa.close();
  }
}

// ─── Facebook (public sayfa) ──────────────────────────────────────
async function facebookVeriAl(browser) {
  const ay = suankiAy();
  log("Facebook taranıyor (public)...");
  const sayfa = await browser.newPage();
  try {
    await sayfa.setExtraHTTPHeaders({
      "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    });

    await sayfa.goto(`https://www.facebook.com/${FACEBOOK_HESAP}`, { waitUntil: "networkidle", timeout: 30000 });
    await sayfa.waitForTimeout(3000);

    let takipci = null;

    // og:description meta tag
    const desc = await sayfa.$eval('meta[name="description"], meta[property="og:description"]',
      (el) => el.content).catch(() => "");
    const eslDesc = desc.match(/([\d,.]+[KMB]?)\s*(takipçi|follower|like|beğen)/i);
    if (eslDesc) takipci = sayiCoz(eslDesc[1]);

    // Sayfa içeriğinden "X kişi bunu takip ediyor" kalıbı
    if (!takipci) {
      const metin   = await sayfa.textContent("body").catch(() => "");
      const eslMetin = metin.match(/([\d,.]+[KMB]?)\s*(kişi bunu takip|takipçi|followers)/i);
      if (eslMetin) takipci = sayiCoz(eslMetin[1]);
    }

    // Public gönderilerden etkileşim topla
    const postler = await sayfa.$$("[role='article']").catch(() => []);
    const icerikler = [];
    for (const post of postler.slice(0, 10)) {
      try {
        const yazi   = await post.textContent().catch(() => "");
        const begEsl = yazi.match(/([\d,.]+[KMB]?)\s*(beğen|like)/i);
        const yorEsl = yazi.match(/([\d,.]+[KMB]?)\s*(yorum|comment)/i);
        const payEsl = yazi.match(/([\d,.]+[KMB]?)\s*(paylaş|share)/i);
        const url    = await post.$eval("a[href*='/posts/'], a[href*='/videos/'], a[href*='/photos/']",
          (a) => a.href).catch(() => null);
        const baslik = yazi.replace(/\s+/g, " ").substring(0, 300).trim();
        if (baslik.length > 15) {
          icerikler.push({
            icerik_id: url || `fb-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            baslik,
            url: url || `https://www.facebook.com/${FACEBOOK_HESAP}`,
            begeni:    begEsl ? sayiCoz(begEsl[1]) || 0 : 0,
            yorum:     yorEsl ? sayiCoz(yorEsl[1]) || 0 : 0,
            paylasim:  payEsl ? sayiCoz(payEsl[1]) || 0 : 0,
            goruntuleme: 0, tarih: null,
          });
        }
      } catch (_) {}
    }

    const toplamEtkilesim = icerikler.reduce((t, ic) => t + ic.begeni + ic.yorum + ic.paylasim, 0);
    await apiyeKaydet("/api/scraper/istatistik", {
      platform: "facebook", ay, takipci, etkilesim: toplamEtkilesim, icerik_sayisi: icerikler.length,
    });
    await apiyeKaydet("/api/scraper/icerikler", { platform: "facebook", ay, icerikler });
    log(`Facebook: ${takipci} takipçi, ${icerikler.length} gönderi`);
  } catch (e) {
    log(`Facebook hatası: ${e.message}`);
  } finally {
    await sayfa.close();
  }
}

// ─── X / Twitter (public) ────────────────────────────────────────
async function xVeriAl(browser) {
  const ay = suankiAy();
  log("X taranıyor (public)...");
  const sayfa = await browser.newPage();
  try {
    await sayfa.setExtraHTTPHeaders({
      "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    });

    await sayfa.goto(`https://x.com/${X_HESAP}`, { waitUntil: "networkidle", timeout: 30000 });
    await sayfa.waitForTimeout(4000);

    // Takipçi sayısı — birden fazla yol
    let takipci = null;

    const metaDesc = await sayfa.$eval('meta[name="description"], meta[property="og:description"]',
      (m) => m.content).catch(() => "");
    const eslMeta = metaDesc.match(/([\d,]+)\s*Follower/i);
    if (eslMeta) takipci = sayiCoz(eslMeta[1]);

    if (!takipci) {
      // data-testid="UserProfileHeader_Items" içindeki follower linki
      const followerEl = await sayfa.$('a[href$="/followers"] span span').catch(() => null);
      if (followerEl) takipci = sayiCoz(await followerEl.textContent().catch(() => ""));
    }

    // Tweetler
    const icerikler = [];
    const tweetler  = await sayfa.$$('[data-testid="tweet"]').catch(() => []);
    for (const tweet of tweetler.slice(0, 15)) {
      try {
        const yazi = await tweet.$eval('[data-testid="tweetText"]', (el) => el.textContent).catch(() => "");
        if (!yazi) continue;
        const begeniEl = await tweet.$('[data-testid="like"] span').catch(() => null);
        const rtEl     = await tweet.$('[data-testid="retweet"] span').catch(() => null);
        const yorumEl  = await tweet.$('[data-testid="reply"] span').catch(() => null);
        const linkEl   = await tweet.$("a[href*='/status/']").catch(() => null);
        const url      = linkEl ? `https://x.com${await linkEl.getAttribute("href")}` : null;
        icerikler.push({
          icerik_id:   url?.split("/status/")[1] || `x-${Date.now()}`,
          baslik:      yazi.substring(0, 300),
          url:         url || `https://x.com/${X_HESAP}`,
          begeni:      sayiCoz(await begeniEl?.textContent().catch(() => "")) || 0,
          yorum:       sayiCoz(await yorumEl?.textContent().catch(() => "")) || 0,
          paylasim:    sayiCoz(await rtEl?.textContent().catch(() => "")) || 0,
          goruntuleme: 0, tarih: null,
        });
      } catch (_) {}
    }

    const toplamEtkilesim = icerikler.reduce((t, ic) => t + ic.begeni + ic.yorum + ic.paylasim, 0);
    await apiyeKaydet("/api/scraper/istatistik", {
      platform: "x", ay, takipci, etkilesim: toplamEtkilesim, icerik_sayisi: icerikler.length,
    });
    await apiyeKaydet("/api/scraper/icerikler", { platform: "x", ay, icerikler });
    log(`X: ${takipci} takipçi, ${icerikler.length} tweet`);
  } catch (e) {
    log(`X hatası: ${e.message}`);
  } finally {
    await sayfa.close();
  }
}

// ─── Ana tarama ──────────────────────────────────────────────────
async function tara() {
  log("══════ Tarama başlıyor ══════");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
           "--disable-blink-features=AutomationControlled"],
  });
  try {
    await youtubeVeriAl(browser);
    await instagramVeriAl(browser);
    await facebookVeriAl(browser);
    await xVeriAl(browser);
  } finally {
    await browser.close();
  }
  log("══════ Tarama tamamlandı ══════");
}

// ─── HTTP sunucusu ───────────────────────────────────────────────
const app = express();
app.use(express.json());
app.get("/saglik", (_req, res) => res.json({ durum: "calisıyor" }));
app.post("/tara", (_req, res) => {
  res.json({ durum: "tarama_basladi" });
  tara().catch((e) => log(`Tetikleme hatası: ${e.message}`));
});
app.listen(3001, () => log("Scraper :3001 portunda başladı"));

// ─── Cron: her ayın 1'i 06:00 (İstanbul) ────────────────────────
cron.schedule("0 6 1 * *", () => {
  log("Zamanlanmış tarama başlatıldı");
  tara().catch((e) => log(`Zamanlı hata: ${e.message}`));
}, { timezone: "Europe/Istanbul" });

log("Scraper hazır. Her ayın 1'i saat 06:00'da otomatik çalışır.");
