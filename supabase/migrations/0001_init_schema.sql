-- supabase/migrations/0001_init_schema.sql

create table categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  label text not null,
  section_id text not null
);

create table headlines (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id) on delete cascade,
  title text not null,
  link text not null,
  collected_date date not null,
  created_at timestamptz not null default now(),
  unique (category_id, link)
);

create index headlines_collected_date_idx on headlines (collected_date);

create table headline_nouns (
  id bigint generated always as identity primary key,
  headline_id uuid not null references headlines(id) on delete cascade,
  word text not null
);

create index headline_nouns_headline_id_idx on headline_nouns (headline_id);
create index headline_nouns_word_idx on headline_nouns (word);

alter table categories enable row level security;
alter table headlines enable row level security;
alter table headline_nouns enable row level security;

create policy "public read categories" on categories for select using (true);
create policy "public read headlines" on headlines for select using (true);
create policy "public read headline_nouns" on headline_nouns for select using (true);

insert into categories (slug, label, section_id) values
  ('politics', '정치', '100'),
  ('economy', '경제', '101'),
  ('society', '사회', '102'),
  ('culture', '생활/문화', '103'),
  ('world', '세계', '104'),
  ('it', 'IT/과학', '105');
