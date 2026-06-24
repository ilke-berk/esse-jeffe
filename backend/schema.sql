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
  sizes       text[] not null default '{XS,S,M,L,XL,2XL,3XL}',
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
  created_at timestamptz not null default now()
);

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
  created_at     timestamptz not null default now()
);
create index if not exists idx_orders_user on orders(user_id);

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
alter table newsletter_subscribers enable row level security;
alter table contact_messages       enable row level security;

-- Ürünler: herkes yayındakileri okuyabilir
drop policy if exists "ürünler herkese açık" on products;
create policy "ürünler herkese açık" on products
  for select using (active = true);

drop policy if exists "renkler herkese açık" on product_colors;
create policy "renkler herkese açık" on product_colors for select using (true);

drop policy if exists "görseller herkese açık" on product_images;
create policy "görseller herkese açık" on product_images for select using (true);

-- Profil: kişi kendi profilini görür/günceller
drop policy if exists "kendi profilini gör" on profiles;
create policy "kendi profilini gör" on profiles for select using (auth.uid() = id);
drop policy if exists "kendi profilini güncelle" on profiles;
create policy "kendi profilini güncelle" on profiles for update using (auth.uid() = id);

-- Adresler: kişi yalnızca kendi adreslerini yönetir
drop policy if exists "kendi adreslerim" on addresses;
create policy "kendi adreslerim" on addresses for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Siparişler: herkes (misafir dahil) sipariş oluşturabilir;
-- yalnızca üye kendi siparişlerini geri okuyabilir.
drop policy if exists "sipariş oluştur" on orders;
create policy "sipariş oluştur" on orders for insert with check (true);
drop policy if exists "kendi siparişlerim" on orders;
create policy "kendi siparişlerim" on orders for select using (auth.uid() = user_id);

drop policy if exists "sipariş kalemi ekle" on order_items;
create policy "sipariş kalemi ekle" on order_items for insert with check (true);
drop policy if exists "kendi sipariş kalemlerim" on order_items;
create policy "kendi sipariş kalemlerim" on order_items for select
  using (exists (select 1 from orders o where o.id = order_id and o.user_id = auth.uid()));

-- Bülten & iletişim: herkes kayıt bırakabilir, kimse geri okuyamaz (admin service_role hariç)
drop policy if exists "bültene abone ol" on newsletter_subscribers;
create policy "bültene abone ol" on newsletter_subscribers for insert with check (true);
drop policy if exists "iletişim mesajı bırak" on contact_messages;
create policy "iletişim mesajı bırak" on contact_messages for insert with check (true);

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
