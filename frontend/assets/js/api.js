const API = (() => {
  const BASE = "/api";

  function token() {
    return localStorage.getItem("token");
  }

  async function istek(yol, secenekler = {}) {
    const headers = { ...(secenekler.headers || {}) };
    if (token()) headers["Authorization"] = "Bearer " + token();
    // Sadece Content-Type set edilmemişse ve FormData değilse JSON ekle
    if (!(secenekler.body instanceof FormData) && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    const yanit = await fetch(BASE + yol, { ...secenekler, headers });
    if (yanit.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("kullanici");
      window.location.href = "/giris";
      return;
    }
    if (!yanit.ok) {
      const hata = await yanit.json().catch(() => ({ detail: "Sunucu hatası" }));
      // FastAPI bazen detail'i array olarak döner
      const detail = hata.detail;
      const mesaj = Array.isArray(detail)
        ? (detail[0]?.msg || "Geçersiz istek")
        : (detail || "İşlem başarısız");
      throw new Error(mesaj);
    }
    if (yanit.status === 204) return null;
    return yanit.json();
  }

  return {
    girisYap: (adi, sifre) => {
      const form = new URLSearchParams();
      form.append("username", adi);
      form.append("password", sifre);
      return istek("/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      });
    },
    benKimim: () => istek("/auth/ben"),

    // Temsilcilikler
    temsilcilikler: () => istek("/temsilcilikler"),
    temsilcilikOlustur: (v) => istek("/temsilcilikler", { method: "POST", body: JSON.stringify(v) }),
    temsilcilikGuncelle: (id, v) => istek(`/temsilcilikler/${id}`, { method: "PUT", body: JSON.stringify(v) }),
    temsilcilikSil: (id) => istek(`/temsilcilikler/${id}`, { method: "DELETE" }),

    // Kullanıcılar
    kullanicilar: () => istek("/kullanicilar"),
    kullaniciOlustur: (v) => istek("/kullanicilar", { method: "POST", body: JSON.stringify(v) }),
    kullaniciGuncelle: (id, v) => istek(`/kullanicilar/${id}`, { method: "PUT", body: JSON.stringify(v) }),
    kullaniciSil: (id) => istek(`/kullanicilar/${id}`, { method: "DELETE" }),

    // Görseller
    gorseller: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return istek("/gorseller" + (q ? "?" + q : ""));
    },
    gorselTakvim: () => istek("/gorseller/takvim"),
    gorselBaslikGuncelle: (id, baslik) => istek(`/gorseller/${id}/baslik`, { method: "PUT", body: JSON.stringify({ baslik }) }),
    gorselSil: (id) => istek(`/gorseller/${id}`, { method: "DELETE" }),

    // Logo
    logoYukle: (dosya) => {
      return new Promise((resolve, reject) => {
        const form = new FormData();
        form.append("dosya", dosya);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", BASE + "/logo");
        xhr.setRequestHeader("Authorization", "Bearer " + token());
        xhr.onload = () => {
          if (xhr.status === 200) resolve(JSON.parse(xhr.responseText));
          else { try { reject(new Error(JSON.parse(xhr.responseText).detail)); } catch { reject(new Error("Yükleme hatası")); } }
        };
        xhr.onerror = () => reject(new Error("Ağ hatası"));
        xhr.send(form);
      });
    },

    gorselYukle: (dosya, notMetni, progressCb) => {
      return new Promise((resolve, reject) => {
        const form = new FormData();
        form.append("dosya", dosya);
        form.append("baslik", notMetni || "");

        const xhr = new XMLHttpRequest();
        xhr.open("POST", BASE + "/gorseller");
        xhr.setRequestHeader("Authorization", "Bearer " + token());

        if (progressCb) {
          xhr.upload.addEventListener("progress", (e) => {
            if (e.lengthComputable) progressCb(Math.round((e.loaded / e.total) * 100));
          });
        }

        xhr.onload = () => {
          if (xhr.status === 201) resolve(JSON.parse(xhr.responseText));
          else {
            try { reject(new Error(JSON.parse(xhr.responseText).detail)); }
            catch { reject(new Error("Yükleme hatası")); }
          }
        };
        xhr.onerror = () => reject(new Error("Ağ hatası"));
        xhr.send(form);
      });
    },
  };
})();

// ─── Auth yardımcıları ───
function mevcutKullanici() {
  try { return JSON.parse(localStorage.getItem("kullanici")); }
  catch { return null; }
}

function cikisYap() {
  localStorage.removeItem("token");
  localStorage.removeItem("kullanici");
  window.location.href = "/giris";
}
