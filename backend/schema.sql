-- ============================================================
--  Esse Jeffe — Supabase veritabanı şeması
--  Supabase > SQL Editor > New query > bu dosyayı yapıştır > Run
--  (Tek seferde çalıştırılabilir; tekrar çalıştırmaya karşı güvenli.)
-- ============================================================

-- ----- UZANTILAR -----
create extension if not exists "uuid-ossp";

-- ============================================================
--  ÜRÜNLER
-- ============================================================
create table if not exists products (
  id          uuid primary key default uuid_generate_v4(),
  slug        text unique not null,
  name        text not null,                    -- "Pera"
  model_desc  text,                             -- "Uzun Yırtmaçlı Krep Abiye"
  description text,                             -- uzun açıklama
  price       integer not null,                 -- güncel fiyat (TL, tam sayı)
  old_price   integer,                          -- üstü çizili fiyat (indirim yoksa null)
  badge       text,                             -- "Çok Satan" / "Yeni" / "İndirim" / null
  category    text,                             -- "cok-satan" / "yeni" / "askili" / "indirim" ...
  sizes       text[] not null default '{S,M,L,XL,2XL,3XL}',
  featured    boolean not null default false,   -- ana sayfada öne çıkar
  active      boolean not null default true,    -- yayında mı
  sort        integer not null default 0,
  created_at  timestamptz not null default now()
);

-- Ürün renkleri (her rengin kendi görseli olabilir)
create table if not exists product_colors (
  id         uuid primary key default uuid_generate_v4(),
  product_id uuid not null references products(id) on delete cascade,
  name       text not null,                     -- "Bordo"
  hex        text not null,                     -- "#6e2c2c"
  image_url  text,                              -- bu renge ait görsel (Storage URL)
  sort       integer not null default 0
);
create index if not exists idx_colors_product on product_colors(product_id);

-- Ürün galeri görselleri (renkten bağımsız ek görseller)
create table if not exists product_images (
  id         uuid primary key default uuid_generate_v4(),
  product_id uuid not null references products(id) on delete cascade,
  url        text not null,
  sort       integer not null default 0
);
create index if not exists idx_images_product on product_images(product_id);

-- ============================================================
--  ÜYE PROFİLLERİ  (auth.users ile 1-1)
-- ============================================================
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  phone      text,
  is_admin   boolean not null default false,   -- admin paneline erişim yetkisi
  created_at timestamptz not null default now()
);
-- Daha önce kurulmuş veritabanlarında kolon eksikse ekle (tekrar çalıştırmaya güvenli)
alter table profiles add column if not exists is_admin boolean not null default false;

-- Yeni kullanıcı kaydolunca otomatik profil oluştur
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'phone')
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Üyelerin kayıtlı teslimat adresleri
create table if not exists addresses (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text,                             -- "Ev" / "İş"
  full_name   text not null,
  phone       text not null,
  city        text not null,
  district    text not null,
  address     text not null,
  postal_code text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_addresses_user on addresses(user_id);

-- ============================================================
--  SİPARİŞLER
-- ============================================================
create table if not exists orders (
  id             uuid primary key default uuid_generate_v4(),
  order_no       text unique not null default 'EJ' || to_char(now(),'YYMMDD') || lpad((floor(random()*100000))::int::text, 5, '0'),
  user_id        uuid references auth.users(id) on delete set null,  -- misafirde null
  status         text not null default 'pending',   -- pending|preparing|shipped|delivered|cancelled
  payment_method text not null,                      -- cod | card | transfer
  payment_status text not null default 'pending',    -- pending|paid|failed|cod
  subtotal       integer not null,
  shipping_fee   integer not null default 0,         -- ücretsiz kargo
  total          integer not null,
  full_name      text not null,
  phone          text not null,
  email          text,
  city           text not null,
  district       text not null,
  address        text not null,
  postal_code    text,
  note           text,
  paid_at        timestamptz,                        -- ödeme onaylandığı an (PayTR callback)
  payment_ref    text,                               -- ödeme sağlayıcı referansı / merchant_oid
  carrier        text,                               -- kargo firması (admin girer)
  tracking_no    text,                               -- kargo takip numarası (admin girer)
  created_at     timestamptz not null default now()
);
create index if not exists idx_orders_user on orders(user_id);
create index if not exists idx_orders_created on orders(created_at desc);
-- Daha önce kurulmuş veritabanlarında kolonlar eksikse ekle (tekrar çalıştırmaya güvenli)
alter table orders add column if not exists paid_at     timestamptz;
alter table orders add column if not exists payment_ref text;
alter table orders add column if not exists carrier     text;
alter table orders add column if not exists tracking_no text;

create table if not exists order_items (
  id           uuid primary key default uuid_generate_v4(),
  order_id     uuid not null references orders(id) on delete cascade,
  product_id   uuid references products(id) on delete set null,
  product_name text not null,                    -- anlık kopya (ürün silinse de kalır)
  model_desc   text,
  color        text,
  size         text,
  unit_price   integer not null,
  qty          integer not null
);
create index if not exists idx_items_order on order_items(order_id);

-- ============================================================
--  STOK / ENVANTER
--  Varyant (ürün + renk + beden) başına stok adedi.
--  color/size '' (boş) ise o boyutta ayrım yapılmadığı anlamına gelir.
--  track=false → o varyant SINIRSIZ kabul edilir (stok takibi yok);
--  track=true  → stok 0'a inince o varyant satışa kapanır (aşırı satış önlenir).
--  Stok düşümü/iadesi YALNIZCA reserve_stock_bulk/restore_stock_bulk
--  fonksiyonları (service_role, Edge Function) üzerinden, atomik yapılır.
-- ============================================================
create table if not exists product_stock (
  product_id uuid not null references products(id) on delete cascade,
  color      text not null default '',            -- renk adı ("Bordo") veya ''
  size       text not null default '',            -- beden ("M") veya ''
  stock      integer not null default 0 check (stock >= 0),
  track      boolean not null default true,        -- false → sınırsız
  updated_at timestamptz not null default now(),
  primary key (product_id, color, size)
);
create index if not exists idx_stock_product on product_stock(product_id);

-- ============================================================
--  FORMLAR
-- ============================================================
create table if not exists newsletter_subscribers (
  id         uuid primary key default uuid_generate_v4(),
  email      text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists contact_messages (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null,
  email      text not null,
  phone      text,
  subject    text,
  order_no   text,
  message    text not null,
  handled    boolean not null default false,
  created_at timestamptz not null default now()
);

-- Form gönderimlerinde IP başına hız sınırı için sayaç tablosu.
-- Yalnızca submit-form Edge Function (service_role) yazar/okur; client erişimi yok.
create table if not exists form_rate_limit (
  id         bigint generated always as identity primary key,
  ip         text not null,
  kind       text not null,                    -- 'newsletter' | 'contact'
  created_at timestamptz not null default now()
);
create index if not exists idx_frl_ip_kind_time on form_rate_limit(ip, kind, created_at);
create index if not exists idx_frl_time on form_rate_limit(created_at);

-- Chat Edge Function'da IP başına hız sınırı için sayaç tablosu (bill amplification savunması).
-- Yalnızca chat Edge Function (service_role) yazar/okur; client erişimi yok.
-- kind: 'start' (yeni konuşma kotası) | 'send' (mesaj/Gemini çağrısı sınırı)
create table if not exists chat_rate_limit (
  id         bigint generated always as identity primary key,
  ip         text not null,
  kind       text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_crl_ip_kind_time on chat_rate_limit(ip, kind, created_at);
create index if not exists idx_crl_time on chat_rate_limit(created_at);

-- Misafir sipariş takibinde IP başına hız sınırı için sayaç tablosu.
-- track-order Edge Function (service_role) yazar/okur; client erişimi yok.
-- Amaç: order_no tahmini (enumeration) ve telefon kaba kuvvet denemelerini yavaşlatmak.
create table if not exists order_track_rate_limit (
  id         bigint generated always as identity primary key,
  ip         text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_otrl_ip_time on order_track_rate_limit(ip, created_at);
create index if not exists idx_otrl_time on order_track_rate_limit(created_at);

-- Genel amaçlı IP hız sınırı sayacı (kind ile ayrışır).
-- Kullananlar: create-order + paytr-token (kind='order' — sipariş spam'i),
-- log-error (kind='client_error' — hata raporu seli). Yalnız Edge Function'lar
-- (service_role) yazar/okur; client erişimi yok. Yeni bir fonksiyona hız sınırı
-- gerektiğinde yeni tablo açmak yerine buraya yeni bir kind eklenir.
create table if not exists fn_rate_limit (
  id         bigint generated always as identity primary key,
  ip         text not null,
  kind       text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_fnrl_ip_kind_time on fn_rate_limit(ip, kind, created_at);
create index if not exists idx_fnrl_time on fn_rate_limit(created_at);

-- ============================================================
--  HATA İZLEME — istemci JS hataları
--  ej.js (EJMonitor) tarayıcıda yakaladığı hataları log-error Edge
--  Function'ına gönderir; fonksiyon (service_role) buraya yazar.
--  Client insert'i YOK (RLS); okuma yalnız admin (is_admin()).
--  Bakış: Supabase Dashboard → Table Editor → client_errors
--  (veya SQL: select * from client_errors order by created_at desc limit 50)
-- ============================================================
create table if not exists client_errors (
  id         bigint generated always as identity primary key,
  message    text not null,
  stack      text,
  source     text,          -- hatanın çıktığı dosya/URL
  line       integer,
  col        integer,
  url        text,          -- hatanın görüldüğü sayfa (path)
  ua         text,          -- tarayıcı user-agent (kısaltılmış)
  ip         text,
  created_at timestamptz not null default now()
);
create index if not exists idx_cerr_time on client_errors(created_at desc);

-- ============================================================
--  CANLI DESTEK / SOHBET
--  Ziyaretçi <-> AI (Gemini) <-> admin arası sohbet.
--  Ziyaretçi erişimi doğrudan RLS ile DEĞİL, chat Edge Function
--  (service_role, RLS baypas) üzerinden olur; visitor_token ile eşleşir.
--  Realtime aboneliği ve panel yönetimi admin (is_admin) içindir.
-- ============================================================
create table if not exists chat_conversations (
  id              uuid primary key default gen_random_uuid(),
  visitor_token   uuid not null default gen_random_uuid(),  -- ziyaretçiyi tanıyan gizli anahtar
  user_id         uuid references auth.users(id) on delete set null,  -- üyeyse
  status          text not null default 'ai',   -- 'ai' | 'agent' (canlı temsilci) | 'closed'
  visitor_name    text,
  visitor_email   text,
  page            text,                          -- konuşmanın başladığı sayfa
  unread_admin    boolean not null default false,-- admin için okunmamış var mı
  summary         text,                          -- önceki görüşme(ler)den taşınan AI hafıza notu
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
alter table chat_conversations add column if not exists summary text;
create index if not exists chat_conversations_updated_idx on chat_conversations(last_message_at desc);
-- resume: girişli kullanıcının son konuşmasını hızlı bulmak için
create index if not exists chat_conversations_user_idx on chat_conversations(user_id, last_message_at desc) where user_id is not null;

create table if not exists chat_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references chat_conversations(id) on delete cascade,
  role            text not null check (role in ('user','ai','agent','system')),
  content         text not null,
  created_at      timestamptz not null default now()
);
create index if not exists chat_messages_conv_time_idx on chat_messages(conversation_id, created_at);

-- ============================================================
--  RLS (Row Level Security) — güvenlik kuralları
-- ============================================================
alter table products               enable row level security;
alter table product_colors         enable row level security;
alter table product_images         enable row level security;
alter table profiles               enable row level security;
alter table addresses              enable row level security;
alter table orders                 enable row level security;
alter table order_items            enable row level security;
alter table product_stock          enable row level security;
alter table newsletter_subscribers enable row level security;
alter table contact_messages       enable row level security;
alter table form_rate_limit        enable row level security;
alter table chat_rate_limit        enable row level security;
alter table order_track_rate_limit enable row level security;
alter table fn_rate_limit          enable row level security;
alter table client_errors          enable row level security;
alter table chat_conversations     enable row level security;
alter table chat_messages          enable row level security;

-- Admin kontrolü: giriş yapan kullanıcının profiles.is_admin = true olması.
-- SECURITY DEFINER + boş search_path: RLS politikalarında güvenle çağrılır.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_admin = true
  );
$$;

-- Stok: herkes okuyabilir (ürün sayfasında "tükendi" göstermek için);
-- yazma yalnız admin (panelden adet güncelleme). Düşüm/iade ise RPC ile.
drop policy if exists "stok herkese açık" on product_stock;
create policy "stok herkese açık" on product_stock for select using (true);
drop policy if exists product_stock_admin_write on product_stock;
create policy product_stock_admin_write on product_stock
  for all to authenticated using (is_admin()) with check (is_admin());

-- ============================================================
--  STOK AYIRMA / İADE (atomik, yarış koşulundan muaf)
--  Edge Function'lar (service_role) sipariş oluştururken çağırır.
--  SECURITY DEFINER: RLS'i baypas eder; anon/authenticated bu
--  fonksiyonları çağıramaz (execute yetkisi aşağıda kısıtlanır).
-- ============================================================

-- Tüm sepet için stoğu TEK işlemde (transaction) ayır.
-- p_items: [{ "product_id": uuid, "color": text, "size": text, "qty": int }, ...]
-- Dönüş: {"ok": true}  → hepsi ayrıldı;
--        {"ok": false, "product_id":..., "color":..., "size":..., "available": n}
--        → o varyantta yeterli stok yok; HİÇBİR düşüm yapılmadı.
-- Yöntem: iki geçiş. 1) her satırı FOR UPDATE ile kilitle + yeterlilik doğrula.
-- Yetersizse hemen dön (henüz düşüm yok → geri alma gerekmez). 2) hepsi
-- geçerse kilitli satırlarda stoğu düş. Kilitler işlem sonuna dek tutulduğu
-- için eşzamanlı siparişler serileşir; aşırı satış imkânsızdır.
create or replace function public.reserve_stock_bulk(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        record;
  v_track  boolean;
  v_stock  integer;
begin
  -- 1. GEÇİŞ: kilitle ve doğrula.
  -- Aynı varyant sepette birden çok satırda olabilir → varyant başına toplam
  -- adede indirgenir (group by), böylece her varyant TEK kez kilitlenir ve
  -- toplam talep doğru kontrol edilir. Kilitler DETERMİNİSTİK sırada alınır
  -- (order by) → iki eşzamanlı sipariş aynı varyantları ters sırada kilitleyip
  -- DEADLOCK'a düşmez.
  for r in
    select (value->>'product_id')::uuid as product_id,
           coalesce(value->>'color', '') as color,
           coalesce(value->>'size', '') as size,
           sum(greatest(1, coalesce((value->>'qty')::int, 1)))::int as qty
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as t(value)
    where value->>'product_id' is not null
    group by 1, 2, 3
    order by 1, 2, 3
  loop
    select track, stock into v_track, v_stock
      from public.product_stock
     where product_id = r.product_id and color = r.color and size = r.size
     for update;

    if not found or v_track = false then
      continue;                       -- takip edilmeyen varyant → sınırsız
    end if;
    if v_stock < r.qty then
      return jsonb_build_object(
        'ok', false, 'product_id', r.product_id,
        'color', r.color, 'size', r.size, 'available', v_stock);
    end if;
  end loop;

  -- 2. GEÇİŞ: düş (tüm satırlar hâlâ kilitli). Aynı gruplama ile.
  for r in
    select (value->>'product_id')::uuid as product_id,
           coalesce(value->>'color', '') as color,
           coalesce(value->>'size', '') as size,
           sum(greatest(1, coalesce((value->>'qty')::int, 1)))::int as qty
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as t(value)
    where value->>'product_id' is not null
    group by 1, 2, 3
  loop
    update public.product_stock
       set stock = stock - r.qty, updated_at = now()
     where product_id = r.product_id and color = r.color and size = r.size
       and track = true;
  end loop;

  return jsonb_build_object('ok', true);
end;
$$;

-- Ayrılan stoğu geri ekle (kart ödemesi başarısız/iptal, sipariş geri alma).
create or replace function public.restore_stock_bulk(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  it      jsonb;
  v_pid   uuid;
  v_color text;
  v_size  text;
  v_qty   integer;
begin
  for it in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as t(value)
  loop
    v_pid   := (it->>'product_id')::uuid;
    v_color := coalesce(it->>'color', '');
    v_size  := coalesce(it->>'size', '');
    v_qty   := greatest(1, coalesce((it->>'qty')::int, 1));
    if v_pid is null then continue; end if;

    update public.product_stock
       set stock = stock + v_qty, updated_at = now()
     where product_id = v_pid and color = v_color and size = v_size
       and track = true;
  end loop;
end;
$$;

-- GÜVENLİK: bu fonksiyonları yalnızca service_role (Edge Function) çağırabilsin.
-- Önce herkesten (PUBLIC dahil) al, sonra yalnız service_role'e ver.
revoke all on function public.reserve_stock_bulk(jsonb) from public, anon, authenticated;
revoke all on function public.restore_stock_bulk(jsonb) from public, anon, authenticated;
grant execute on function public.reserve_stock_bulk(jsonb) to service_role;
grant execute on function public.restore_stock_bulk(jsonb) to service_role;

-- Ürünler: herkes yayındakileri okuyabilir; yazma yalnız admin.
-- admin-urunler.html anon publishable key ile bağlanır; ekleme/düzenleme/silme
-- ancak giriş yapmış ve is_admin=true olan kullanıcıda çalışır.
drop policy if exists "ürünler herkese açık" on products;
create policy "ürünler herkese açık" on products
  for select using (active = true);
drop policy if exists products_admin_write on products;
create policy products_admin_write on products
  for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "renkler herkese açık" on product_colors;
create policy "renkler herkese açık" on product_colors for select using (true);
drop policy if exists product_colors_admin_write on product_colors;
create policy product_colors_admin_write on product_colors
  for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "görseller herkese açık" on product_images;
create policy "görseller herkese açık" on product_images for select using (true);
drop policy if exists product_images_admin_write on product_images;
create policy product_images_admin_write on product_images
  for all to authenticated using (is_admin()) with check (is_admin());

-- Profil: kişi kendi profilini görür/günceller
drop policy if exists "kendi profilini gör" on profiles;
create policy "kendi profilini gör" on profiles for select using (auth.uid() = id);
drop policy if exists "kendi profilini güncelle" on profiles;
create policy "kendi profilini güncelle" on profiles for update using (auth.uid() = id);

-- Adresler: kişi yalnızca kendi adreslerini yönetir
drop policy if exists "kendi adreslerim" on addresses;
create policy "kendi adreslerim" on addresses for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Siparişler: GÜVENLİK — sipariş oluşturma client'a KAPALIDIR.
-- Sipariş yalnızca Edge Function'lar üzerinden (service_role, RLS baypas)
-- oluşturulur: kart → paytr-token, kapıda ödeme/havale → create-order.
-- Böylece tutar her zaman DB'den yeniden hesaplanır; konsoldan fiyat
-- manipülasyonu (ör. "1 TL" COD siparişi) mümkün değildir.
-- Üye yalnızca kendi siparişlerini geri okuyabilir.
drop policy if exists "sipariş oluştur" on orders;                 -- eski açık insert politikasını kaldır
drop policy if exists "kendi siparişlerim" on orders;
create policy "kendi siparişlerim" on orders for select using (auth.uid() = user_id);

drop policy if exists "sipariş kalemi ekle" on order_items;        -- eski açık insert politikasını kaldır
drop policy if exists "kendi sipariş kalemlerim" on order_items;
create policy "kendi sipariş kalemlerim" on order_items for select
  using (exists (select 1 from orders o where o.id = order_id and o.user_id = auth.uid()));

-- Admin sipariş yönetimi (panel: admin-siparisler.html).
-- GÜVENLİK: admin YALNIZCA okuyup GÜNCELLEYEBİLİR (durum/kargo bilgisi);
-- INSERT hâlâ yok → sipariş oluşturma yalnız Edge Function (service_role) ile
-- kalır, böylece tutar/fiyat bütünlüğü korunur. DELETE de verilmez (iptal =
-- status güncellemesi). is_admin() SECURITY DEFINER olduğundan RLS özyinelemesi
-- yaşanmaz.
drop policy if exists orders_admin_read on orders;
create policy orders_admin_read on orders for select to authenticated using (is_admin());
drop policy if exists orders_admin_update on orders;
create policy orders_admin_update on orders for update to authenticated
  using (is_admin()) with check (is_admin());
drop policy if exists order_items_admin_read on order_items;
create policy order_items_admin_read on order_items for select to authenticated using (is_admin());

-- Bülten & iletişim: GÜVENLİK — doğrudan client insert'i KAPALIDIR.
-- Eskiden "with check (true)" idi; herhangi bir anon bot tablolara sınırsız
-- satır yazabiliyordu (spam / DB şişmesi). Artık yazma yalnızca submit-form
-- Edge Function'ı üzerinden (service_role) olur: honeypot + IP hız sınırı orada
-- uygulanır. Aşağıdaki drop'lar eski açık politikaları kaldırır; yerine yeni
-- insert politikası EKLENMEZ, böylece anon/authenticated rol yazamaz.
drop policy if exists "bültene abone ol" on newsletter_subscribers;
drop policy if exists "iletişim mesajı bırak" on contact_messages;
-- form_rate_limit: hiçbir client politikası yok → yalnız service_role erişir.
-- chat_rate_limit: hiçbir client politikası yok → yalnız chat Edge Function (service_role) erişir.
-- order_track_rate_limit: hiçbir client politikası yok → yalnız track-order Edge Function (service_role) erişir.
-- fn_rate_limit: hiçbir client politikası yok → yalnız Edge Function'lar (service_role) erişir.

-- İstemci hata kayıtları: yazma yalnız log-error Edge Function (service_role);
-- okuma yalnız admin (ileride panelden hata listesi göstermek için).
drop policy if exists client_errors_admin_read on client_errors;
create policy client_errors_admin_read on client_errors
  for select to authenticated using (is_admin());

-- Sohbet: yalnızca admin doğrudan okuyup yönetir (panel + Realtime).
-- Ziyaretçi tarafı chat Edge Function (service_role) üzerinden işler; bu yüzden
-- anon/authenticated ziyaretçi için ayrı politika YOK.
drop policy if exists chat_conv_admin_all on chat_conversations;
create policy chat_conv_admin_all on chat_conversations
  for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists chat_msg_admin_all on chat_messages;
create policy chat_msg_admin_all on chat_messages
  for all to authenticated using (is_admin()) with check (is_admin());

-- NOT: Admin işlemleri (ürün ekleme/düzenleme, sipariş görüntüleme) Supabase
-- panelinden service_role ile yapılır; service_role RLS'i baypas eder.

-- ============================================================
--  TOHUM VERİ — mevcut katalog
-- ============================================================
insert into products (slug, name, model_desc, price, old_price, badge, category, featured, sort) values
  ('pera',  'Pera',  'Uzun Yırtmaçlı Krep Abiye',         1699, 2199, 'Çok Satan', 'cok-satan', true, 1),
  ('asos',  'Asos',  'Fakir Kol V Yaka Davet Elbisesi',   1399, null, 'Yeni',      'yeni',      true, 2),
  ('efes',  'Efes',  'Kruvaze Drapeli Krep Abiye',        1499, null, null,        'gece',      true, 3),
  ('karya', 'Karya', 'V Yaka Fırfırlı Kol Krep Abiye',    1299, 1599, 'İndirim',   'indirim',   false, 4),
  ('likya', 'Likya', 'Kruvaze Drapeli Askılı Krep Abiye', 1599, null, null,        'askili',    false, 5),
  ('side',  'Side',  'Diz Üstü Ön Drape Detaylı Abiye',   1399, null, 'Yeni',      'yeni',      false, 6),
  ('truva', 'Truva', 'Dekolte Detaylı Krep Abiye',        1299, null, null,        'gece',      false, 7),
  ('milet', 'Milet', 'Yarasa Kol Kruvaze Drapeli Abiye',  1499, null, null,        'gece',      false, 8),
  ('lidya', 'Lidya', 'Ön Fırfır Bodycone Fermuarlı Abiye',1299, null, null,        'gece',      false, 9)
on conflict (slug) do nothing;

-- Renkler (ürün slug'ına göre)
insert into product_colors (product_id, name, hex, sort)
select p.id, c.name, c.hex, c.sort from products p
join (values
  ('pera','Bordo','#6e2c2c',1),('pera','Yeşil','#3c4a3a',2),('pera','Siyah','#1b1a17',3),('pera','Kırmızı','#b03030',4),('pera','Mavi','#26384a',5),
  ('asos','Bordo','#6e2c2c',1),('asos','Siyah','#1b1a17',2),('asos','Yeşil','#3c4a3a',3),('asos','Mavi','#26384a',4),
  ('efes','Kırmızı','#b03030',1),('efes','Bordo','#6e2c2c',2),('efes','Yeşil','#3c4a3a',3),('efes','Siyah','#1b1a17',4),('efes','Mavi','#26384a',5),
  ('karya','Mavi','#26384a',1),('karya','Kırmızı','#b03030',2),('karya','Siyah','#1b1a17',3),('karya','Bordo','#6e2c2c',4),('karya','Yeşil','#3c4a3a',5),
  ('likya','Siyah','#1b1a17',1),('likya','Yeşil','#3c4a3a',2),('likya','Kırmızı','#b03030',3),('likya','Mavi','#26384a',4),
  ('side','Kırmızı','#b03030',1),('side','Yeşil','#3c4a3a',2),('side','Mavi','#26384a',3),
  ('truva','Siyah','#1b1a17',1),
  ('milet','Siyah','#1b1a17',1),('milet','Kırmızı','#b03030',2),('milet','Yeşil','#3c4a3a',3),('milet','Mavi','#26384a',4),
  ('lidya','Siyah','#1b1a17',1)
) as c(slug,name,hex,sort) on c.slug = p.slug
on conflict do nothing;

-- Stok satırları — her (ürün × renk × beden) varyantı için.
-- track=false ile tohumlanır: yani başlangıçta SINIRSIZ (mevcut davranış korunur,
-- hiçbir satış engellenmez). Gerçek envanteri girip aşırı satış korumasını
-- açmak için admin şunu yapar (örnek):
--   update product_stock set stock = 5, track = true
--   where product_id = (select id from products where slug='pera')
--     and color = 'Bordo' and size = 'M';
-- veya bir ürünün tüm varyantlarını topluca:
--   update product_stock set stock = 3, track = true
--   where product_id = (select id from products where slug='pera');
insert into product_stock (product_id, color, size, stock, track)
select pc.product_id, pc.name, s.size, 0, false
from product_colors pc
join products p on p.id = pc.product_id
cross join lateral unnest(p.sizes) as s(size)
on conflict (product_id, color, size) do nothing;
