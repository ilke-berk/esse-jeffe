// ============================================================
//  Esse Jeffe — paylaşılan CORS origin-kilidi (Edge Function'lar)
//  chat/index.ts'teki modelin aynısı: istek origin'i izinliyse yansıtılır,
//  değilse ilk izinli origin konur (tarayıcı yanıtı bloklar).
//
//  NOT: CORS yalnız TARAYICI kaynaklı çağrıları (başka siteye gömme)
//  durdurur; curl/bot Origin göndermez — asıl bot koruması her
//  fonksiyondaki IP hız sınırıdır.
//
//  İzinli listeyi EDGE_ALLOWED_ORIGINS secret'ıyla (virgüllü) yönetin;
//  yoksa CHAT_ALLOWED_ORIGINS, o da yoksa prod alan adları geçerlidir.
//
//  Yerel geliştirme (localhost/127.0.0.1) artık OTOMATİK DEĞİL:
//  EDGE_ALLOW_LOCALHOST=1 ile açılır. Regex iki uçtan çapalı olduğu için
//  bilinen bir baypas yoktu; bu yalnızca prod'da gereksiz izin yüzeyi
//  bırakmama (en az ayrıcalık) tercihidir.
// ============================================================
import { isAllowedOrigin, parseOriginList } from "./util.ts";

const ALLOWED_ORIGINS = parseOriginList(
  Deno.env.get("EDGE_ALLOWED_ORIGINS") ||
    Deno.env.get("CHAT_ALLOWED_ORIGINS") ||
    "https://essejeffe.com,https://www.essejeffe.com",
);

const ALLOW_LOCALHOST = /^(1|true|yes|on)$/i.test(
  Deno.env.get("EDGE_ALLOW_LOCALHOST") || "",
);

/** İstek origin'ine göre CORS başlıkları üret (Deno.serve başında çağrılır). */
export function corsHeaders(origin: string | null): Record<string, string> {
  const o = String(origin || "").replace(/\/+$/, "");
  const allow = isAllowedOrigin(o, ALLOWED_ORIGINS, ALLOW_LOCALHOST)
    ? o
    : (ALLOWED_ORIGINS[0] || "null");
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
