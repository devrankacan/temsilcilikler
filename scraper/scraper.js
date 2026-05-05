"use strict";

const express = require("express");
const cron = require("node-cron");
const axios = require("axios");
const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

chromium.use(StealthPlugin());

const API_BASE = process.env.API_BASE || "http://api:8000";
const SCRAPER_SECRET = process.env.SCRAPER_SECRET || "scraper-secret-key";
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || "";
const INSTAGRAM_KULLANICI = process.env.INSTAGRAM_KULLANICI || "";
const INSTAGRAM_SIFRE = process.env.INSTAGRAM_SIFRE || "";
const FACEBOOK_KULLANICI = process.env.FACEBOOK_KULLANICI || "";
const FACEBOOK_SIFRE = process.env.FACEBOOK_SIFRE || "";

const INSTAGRAM_HESAP = "iyilikdernegi";
const FACEBOOK_HESAP = "iyilikdernegi";
const X_HESAP = "iyilikdernegi";
const YOUTUBE_HANDLE = "iyilikdernegi";

const headers = { "x-scraper-secret": SCRAPER_SECRET };

function suankiAy() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function log(mesaj) {
  console.log(`[${new Date().toISOString()}] ${mesaj}`);
}

async function apiyeKaydet(endpoint, veri) {
  try {
    await axios.post(`${API_BASE}${endpoint}`, veri, { headers });
    log(`✓ Kaydedildi: ${endpoint}`);
  } catch (e) {
    log(`✗ Kayıt hatası (${endpoint}): ${e.message}`);
  }
}

// ─── YouTube (resmi API) ───────────────────────────────────────────
async function youtubeVeriAl() {
  if (!YOUTUBE_API_KEY) { log("YouTube API anahtarı eksik, atlanıyor."); return; }
  const ay = suankiAy();
  try {
    // Kanal bilgileri
    const kanalRes = await axios.get("https://www.googleapis.com/youtube/v3/channels", {
      params: { part: "statistics,snippet", forHandle: YOUTUBE_HANDLE, key: YOUTUBE_API_KEY },
    });
    const kanal = kanalRes.data.items?.[0];
    if (!kanal) { log("YouTube kanalı bulunamadı."); return; }
    const kanalId = kanal.id;
    const takipci = parseInt(kanal.statistics.subscriberCount || 0);

    // Bu aydaki videolar
    const baslangic = `${ay}-01T00:00:00Z`;
    const bitis = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString();
    const arama = await axios.get("https://www.googleapis.com/youtube/v3/search", {
      params: {
        part: "snippet", channelId: kanalId, type: "video", order: "date",
        maxResults: 20, publishedAfter: baslangic, publishedBefore: bitis,
        key: YOUTUBE_API_KEY,
      },
    });
    const videoIds = (arama.data.items || []).map((v) => v.id.videoId).join(",");
    let icerikler = [];
    let toplamEtkilesim = 0;

    if (videoIds) {
      const istatRes = await axios.get("https://www.googleapis.com/youtube/v3/videos", {
        params: { part: "statistics,snippet", id: videoIds, key: YOUTUBE_API_KEY },
      });
      icerikler = (istatRes.data.items || []).map((v) => {
        const s = v.statistics;
        const begeni = parseInt(s.likeCount || 0);
        const yorum = parseInt(s.commentCount || 0);
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
    log(`YouTube hatası: ${e.message}`);
  }
}

// ─── Instagram (Playwright) ────────────────────────────────────────
async function instagramVeriAl(browser) {
  const ay = suankiAy();
  const sayfa = await browser.newPage();
  try {
    await sayfa.setExtraHTTPHeaders({ "Accept-Language": "tr-TR,tr;q=0.9" });

    if (INSTAGRAM_KULLANICI && INSTAGRAM_SIFRE) {
      log("Instagram: giriş yapılıyor...");
      await sayfa.goto("https://www.instagram.com/accounts/login/", { waitUntil: "networkidle", timeout: 30000 });
      await sayfa.waitForTimeout(2000);
      await sayfa.fill('input[name="username"]', INSTAGRAM_KULLANICI);
      await sayfa.fill('input[name="password"]', INSTAGRAM_SIFRE);
      await sayfa.click('button[type="submit"]');
      await sayfa.waitForTimeout(4000);
    }

    log("Instagram: profil yükleniyor...");
    await sayfa.goto(`https://www.instagram.com/${INSTAGRAM_HESAP}/`, { waitUntil: "networkidle", timeout: 30000 });
    await sayfa.waitForTimeout(3000);

    // Takipçi sayısını bul (birden fazla seçici dene)
    let takipci = null;
    const metin = await sayfa.textContent("body").catch(() => "");
    const eslesme = metin.match(/(\d[\d,.]+)\s*(Takipçi|followers)/i);
    if (eslesme) {
      takipci = parseInt(eslesme[1].replace(/[,.]/g, ""));
    }

    // Gönderileri topla
    const icerikler = [];
    const postLinks = await sayfa.$$eval("article a, ._aagw", (els) =>
      els.slice(0, 12).map((el) => el.href || el.closest("a")?.href).filter(Boolean)
    ).catch(() => []);

    for (const link of postLinks.slice(0, 10)) {
      try {
        const pSayfa = await browser.newPage();
        await pSayfa.goto(link, { waitUntil: "networkidle", timeout: 20000 });
        await pSayfa.waitForTimeout(1500);
        const icerikMetin = await pSayfa.textContent("body").catch(() => "");
        const begEsl = icerikMetin.match(/(\d[\d,]+)\s*(beğen|like)/i);
        const yorEsl = icerikMetin.match(/(\d[\d,]+)\s*(yorum|comment)/i);
        const caption = await pSayfa.$eval("h1, ._aacl", (el) => el.textContent?.trim() || "").catch(() => "");
        icerikler.push({
          icerik_id: link.split("/p/")[1]?.replace(/\/$/, "") || link,
          baslik: caption.substring(0, 300),
          url: link,
          begeni: begEsl ? parseInt(begEsl[1].replace(/,/g, "")) : 0,
          yorum: yorEsl ? parseInt(yorEsl[1].replace(/,/g, "")) : 0,
          paylasim: 0, goruntuleme: 0, tarih: null,
        });
        await pSayfa.close();
      } catch (_) {}
    }

    const toplamEtkilesim = icerikler.reduce((t, ic) => t + ic.begeni + ic.yorum, 0);
    await apiyeKaydet("/api/scraper/istatistik", {
      platform: "instagram", ay, takipci, etkilesim: toplamEtkilesim, icerik_sayisi: icerikler.length,
    });
    await apiyeKaydet("/api/scraper/icerikler", { platform: "instagram", ay, icerikler });
    log(`Instagram: ${takipci} takipçi, ${icerikler.length} gönderi`);
  } catch (e) {
    log(`Instagram hatası: ${e.message}`);
  } finally {
    await sayfa.close();
  }
}

// ─── Facebook (Playwright) ────────────────────────────────────────
async function facebookVeriAl(browser) {
  const ay = suankiAy();
  const sayfa = await browser.newPage();
  try {
    await sayfa.setExtraHTTPHeaders({ "Accept-Language": "tr-TR,tr;q=0.9" });

    if (FACEBOOK_KULLANICI && FACEBOOK_SIFRE) {
      log("Facebook: giriş yapılıyor...");
      await sayfa.goto("https://www.facebook.com/login", { waitUntil: "networkidle", timeout: 30000 });
      await sayfa.waitForTimeout(2000);
      await sayfa.fill("#email", FACEBOOK_KULLANICI);
      await sayfa.fill("#pass", FACEBOOK_SIFRE);
      await sayfa.click('[name="login"]');
      await sayfa.waitForTimeout(4000);
    }

    log("Facebook: sayfa yükleniyor...");
    await sayfa.goto(`https://www.facebook.com/${FACEBOOK_HESAP}`, { waitUntil: "networkidle", timeout: 30000 });
    await sayfa.waitForTimeout(3000);

    const metin = await sayfa.textContent("body").catch(() => "");
    let takipci = null;
    const eslesme = metin.match(/(\d[\d,.]+)\s*(takipçi|followers)/i);
    if (eslesme) takipci = parseInt(eslesme[1].replace(/[,.]/g, ""));

    // Son gönderiler
    const icerikler = [];
    const postler = await sayfa.$$("[data-pagelet='FeedUnit'], [role='article']").catch(() => []);
    for (const post of postler.slice(0, 10)) {
      try {
        const yazi = await post.textContent().catch(() => "");
        const begEsl = yazi.match(/(\d[\d,.]+)\s*(beğeni|like)/i);
        const yorEsl = yazi.match(/(\d[\d,.]+)\s*(yorum|comment)/i);
        const url = await post.$eval("a[href*='/posts/'], a[href*='/videos/']", (a) => a.href).catch(() => null);
        if (yazi.length > 10) {
          icerikler.push({
            icerik_id: url || `fb-${Date.now()}-${Math.random()}`,
            baslik: yazi.substring(0, 300).trim(),
            url: url || `https://www.facebook.com/${FACEBOOK_HESAP}`,
            begeni: begEsl ? parseInt(begEsl[1].replace(/[,.]/g, "")) : 0,
            yorum: yorEsl ? parseInt(yorEsl[1].replace(/[,.]/g, "")) : 0,
            paylasim: 0, goruntuleme: 0, tarih: null,
          });
        }
      } catch (_) {}
    }

    const toplamEtkilesim = icerikler.reduce((t, ic) => t + ic.begeni + ic.yorum, 0);
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

// ─── X / Twitter (Playwright) ────────────────────────────────────
async function xVeriAl(browser) {
  const ay = suankiAy();
  const sayfa = await browser.newPage();
  try {
    await sayfa.setExtraHTTPHeaders({ "Accept-Language": "tr-TR,tr;q=0.9" });
    log("X: profil yükleniyor...");
    await sayfa.goto(`https://x.com/${X_HESAP}`, { waitUntil: "networkidle", timeout: 30000 });
    await sayfa.waitForTimeout(4000);

    let takipci = null;
    // Meta tag veya sayfadaki follower sayısı
    const metaDesc = await sayfa.$eval('meta[name="description"]', (m) => m.content).catch(() => "");
    const eslesme = metaDesc.match(/([\d,]+)\s*Followers/i) ||
      (await sayfa.textContent("body").catch(() => "")).match(/(\d[\d,]+)\s*Takipçi/i);
    if (eslesme) takipci = parseInt(eslesme[1].replace(/,/g, ""));

    // Tweetler
    const icerikler = [];
    const tweetler = await sayfa.$$('[data-testid="tweet"]').catch(() => []);
    for (const tweet of tweetler.slice(0, 15)) {
      try {
        const yazi = await tweet.$eval('[data-testid="tweetText"]', (el) => el.textContent).catch(() => "");
        if (!yazi) continue;
        const begeniEl = await tweet.$('[data-testid="like"] span').catch(() => null);
        const begeni = begeniEl ? parseInt((await begeniEl.textContent()).replace(/[,K]/g, "")) || 0 : 0;
        const rtEl = await tweet.$('[data-testid="retweet"] span').catch(() => null);
        const rt = rtEl ? parseInt((await rtEl.textContent()).replace(/[,K]/g, "")) || 0 : 0;
        const yorumEl = await tweet.$('[data-testid="reply"] span').catch(() => null);
        const yorum = yorumEl ? parseInt((await yorumEl.textContent()).replace(/[,K]/g, "")) || 0 : 0;
        const linkEl = await tweet.$("a[href*='/status/']").catch(() => null);
        const url = linkEl ? await linkEl.getAttribute("href").then((h) => `https://x.com${h}`) : null;
        icerikler.push({
          icerik_id: url?.split("/status/")[1] || `x-${Date.now()}`,
          baslik: yazi.substring(0, 300),
          url: url || `https://x.com/${X_HESAP}`,
          begeni, yorum, paylasim: rt, goruntuleme: 0, tarih: null,
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

// ─── Ana tarama fonksiyonu ────────────────────────────────────────
async function tara() {
  log("══════ Tarama başlıyor ══════");
  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
             "--disable-blink-features=AutomationControlled"],
    });

    await youtubeVeriAl();
    await instagramVeriAl(browser);
    await facebookVeriAl(browser);
    await xVeriAl(browser);
  } catch (e) {
    log(`Genel hata: ${e.message}`);
  } finally {
    if (browser) await browser.close();
  }
  log("══════ Tarama tamamlandı ══════");
}

// ─── HTTP sunucusu (manuel tetikleme) ────────────────────────────
const app = express();
app.use(express.json());

app.get("/saglik", (_req, res) => res.json({ durum: "calisıyor" }));

app.post("/tara", async (_req, res) => {
  res.json({ durum: "tarama_basladi" });
  tara().catch((e) => log(`Tetikleme hatası: ${e.message}`));
});

app.listen(3001, () => log("Scraper sunucusu :3001 portunda başladı"));

// ─── Zamanlanmış görev: her ayın 1'i saat 06:00 ──────────────────
// "0 6 1 * *" = dakika 0, saat 6, ayın 1'i
cron.schedule("0 6 1 * *", () => {
  log("Zamanlanmış tarama tetiklendi");
  tara().catch((e) => log(`Zamanlı hata: ${e.message}`));
}, { timezone: "Europe/Istanbul" });

log("Scraper servisi hazır. Tarama her ayın 1'i saat 06:00'da çalışır.");
