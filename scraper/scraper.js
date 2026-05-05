"use strict";

const express = require("express");
const cron = require("node-cron");
const axios = require("axios");
const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

chromium.use(StealthPlugin());

const API_BASE       = process.env.API_BASE       || "http://api:8000";
const SCRAPER_SECRET = process.env.SCRAPER_SECRET || "scraper-secret-key";
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || "";

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

// ─── YouTube (resmi API) ──────────────────────────────────────────
async function youtubeVeriAl() {
  const ay = suankiAy();
  log("YouTube taranıyor...");

  if (!YOUTUBE_API_KEY) {
    log("YouTube API anahtarı tanımlı değil — sayfa scraping deneniyor.");
    return youtubeScrap(ay);
  }

  try {
    const kanalRes = await axios.get("https://www.googleapis.com/youtube/v3/channels", {
      params: { part: "statistics,snippet", forHandle: YOUTUBE_HANDLE, key: YOUTUBE_API_KEY },
      timeout: 15000,
    });
    const kanal = kanalRes.data.items?.[0];
    if (!kanal) { log("YouTube kanalı bulunamadı."); return; }

    const kanalId   = kanal.id;
    const takipci   = parseInt(kanal.statistics.subscriberCount || 0);

    const baslangic = `${ay}-01T00:00:00Z`;
    const sonGun    = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);
    const bitis     = sonGun.toISOString();

    const arama = await axios.get("https://www.googleapis.com/youtube/v3/search", {
      params: { part: "snippet", channelId: kanalId, type: "video", order: "date",
                maxResults: 20, publishedAfter: baslangic, publishedBefore: bitis,
                key: YOUTUBE_API_KEY },
      timeout: 15000,
    });
    const videoIds = (arama.data.items || []).map((v) => v.id.videoId).join(",");
    let icerikler = [];
    let toplamEtkilesim = 0;

    if (videoIds) {
      const istatRes = await axios.get("https://www.googleapis.com/youtube/v3/videos", {
        params: { part: "statistics,snippet", id: videoIds, key: YOUTUBE_API_KEY },
        timeout: 15000,
      });
      icerikler = (istatRes.data.items || []).map((v) => {
        const s       = v.statistics;
        const begeni  = parseInt(s.likeCount    || 0);
        const yorum   = parseInt(s.commentCount || 0);
        const goruntuleme = parseInt(s.viewCount || 0);
        toplamEtkilesim += begeni + yorum;
        return {
          icerik_id: v.id,
          baslik: v.snippet.title,
          url: `https://www.youtube.com/watch?v=${v.id}`,
          begeni, yorum, paylasim: 0, goruntuleme,
          tarih: v.snippet.publishedAt?.substring(0, 10),
        };
      });
    }

    await apiyeKaydet("/api/scraper/istatistik", {
      platform: "youtube", ay, takipci, etkilesim: toplamEtkilesim, icerik_sayisi: icerikler.length,
    });
    await apiyeKaydet("/api/scraper/icerikler", { platform: "youtube", ay, icerikler });
    log(`YouTube: ${takipci} abone, ${icerikler.length} video`);
  } catch (e) {
    log(`YouTube API hatası: ${e.message}`);
  }
}

async function youtubeScrap(ay) {
  // API key yoksa public sayfadan temel bilgi al
  const browser = await chromium.launch({
    headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const sayfa = await browser.newPage();
    await sayfa.goto(`https://www.youtube.com/@${YOUTUBE_HANDLE}`, { waitUntil: "networkidle", timeout: 30000 });
    await sayfa.waitForTimeout(3000);
    const metin   = await sayfa.textContent("body").catch(() => "");
    const esl     = metin.match(/([\d,.]+[KMB]?)\s*abone/i) || metin.match(/([\d,.]+[KMB]?)\s*subscriber/i);
    const takipci = esl ? sayiCoz(esl[1]) : null;
    await sayfa.close();
    await apiyeKaydet("/api/scraper/istatistik", { platform: "youtube", ay, takipci, etkilesim: 0, icerik_sayisi: 0 });
    await apiyeKaydet("/api/scraper/icerikler",  { platform: "youtube", ay, icerikler: [] });
    log(`YouTube (scrape): ${takipci} abone`);
  } catch (e) {
    log(`YouTube scrape hatası: ${e.message}`);
  } finally {
    await browser.close();
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
  await youtubeVeriAl();

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
           "--disable-blink-features=AutomationControlled"],
  });
  try {
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
