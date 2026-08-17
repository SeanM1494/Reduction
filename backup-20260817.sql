--
-- PostgreSQL database dump
--

\restrict NA303QfDLBkIzgKuiPCU4ENfGHZkmmrzXFOAEpol75rNITHeG4FQiVIfugCf7OG

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: auth_states; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.auth_states (
    state text NOT NULL,
    provider text NOT NULL,
    pkce_verifier text,
    pending_url text,
    created_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone NOT NULL
);


ALTER TABLE public.auth_states OWNER TO postgres;

--
-- Name: extraction_cache; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.extraction_cache (
    hash text NOT NULL,
    recipe jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.extraction_cache OWNER TO postgres;

--
-- Name: identities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.identities (
    provider text NOT NULL,
    subject text NOT NULL,
    user_id text NOT NULL,
    email text,
    email_verified boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.identities OWNER TO postgres;

--
-- Name: recipes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.recipes (
    id text NOT NULL,
    owner_key text NOT NULL,
    recipe jsonb NOT NULL,
    done jsonb DEFAULT '[]'::jsonb NOT NULL,
    servings integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    mode text DEFAULT 'diagram'::text NOT NULL,
    timer jsonb,
    user_id text,
    visibility text DEFAULT 'private'::text NOT NULL,
    share_slug text
);


ALTER TABLE public.recipes OWNER TO postgres;

--
-- Name: sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sessions (
    id_hash text NOT NULL,
    user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    last_seen_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone NOT NULL
);


ALTER TABLE public.sessions OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id text NOT NULL,
    display_name text,
    email text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Data for Name: auth_states; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.auth_states (state, provider, pkce_verifier, pending_url, created_at, expires_at) FROM stdin;
\.


--
-- Data for Name: extraction_cache; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.extraction_cache (hash, recipe, created_at) FROM stdin;
7c09c8190e038ef49b73f2fbcfa6b7264a7f239219a98c489db5d614a5a47c1f	{"title": "Simple Egg Recipe", "sections": [{"name": "Eggs", "root": "egg_4", "nodes": [{"id": "egg_1", "label": "crack into bowl", "tempF": null, "inputs": ["egg_eggs"], "minutes": null}, {"id": "egg_2", "label": "whisk with salt", "tempF": null, "inputs": ["egg_1", "egg_salt"], "minutes": null}, {"id": "egg_3", "label": "cook until set", "tempF": null, "inputs": ["egg_2"], "minutes": 2}, {"id": "egg_4", "label": "serve immediately", "tempF": null, "inputs": ["egg_3"], "minutes": null}], "header": null, "ingredients": [{"id": "egg_eggs", "qty": 2, "name": "eggs", "note": null, "text": null, "unit": null, "qtyMax": null}, {"id": "egg_salt", "qty": 1, "name": "salt", "note": null, "text": null, "unit": "pinch", "qtyMax": null}]}], "servings": null, "yieldText": null}	2026-08-08 04:08:55.034535+00
\.


--
-- Data for Name: identities; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.identities (provider, subject, user_id, email, email_verified, created_at) FROM stdin;
\.


--
-- Data for Name: recipes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.recipes (id, owner_key, recipe, done, servings, created_at, updated_at, mode, timer, user_id, visibility, share_slug) FROM stdin;
r1785639776565	e58554f9-864a-4f34-b9b3-896b52d2bd15	{"title": "The Best Chocolate Chip Cookie Recipe Ever", "source": "JoyFoodSunshine", "sections": [{"name": "Chocolate chip cookies", "root": "cookies_8", "nodes": [{"id": "cookies_1", "label": "mix dry ingredients", "tempF": null, "inputs": ["cookies_flour", "cookies_baking_soda", "cookies_baking_powder", "cookies_salt"], "minutes": null}, {"id": "cookies_2", "label": "cream butter and sugars", "tempF": null, "inputs": ["cookies_butter", "cookies_sugar", "cookies_brown_sugar"], "minutes": null}, {"id": "cookies_3", "label": "beat in eggs and vanilla", "tempF": null, "inputs": ["cookies_2", "cookies_eggs", "cookies_vanilla"], "minutes": 1}, {"id": "cookies_4", "label": "mix in dry ingredients", "tempF": null, "inputs": ["cookies_3", "cookies_1"], "minutes": null}, {"id": "cookies_5", "label": "add chocolate chips", "tempF": null, "inputs": ["cookies_4", "cookies_chocolate_chips"], "minutes": null}, {"id": "cookies_6", "label": "roll into balls", "tempF": null, "inputs": ["cookies_5"], "minutes": null}, {"id": "cookies_7", "label": "bake 375°F 9 min", "tempF": 375, "inputs": ["cookies_6"], "minutes": 9}, {"id": "cookies_8", "label": "cool on pan 5 min", "tempF": null, "inputs": ["cookies_7"], "minutes": 5}], "header": "Oven 375°F", "ingredients": [{"id": "cookies_butter", "qty": 1, "name": "salted butter", "note": "softened", "text": null, "unit": "cup"}, {"id": "cookies_sugar", "qty": 1, "name": "granulated sugar", "note": null, "text": null, "unit": "cup"}, {"id": "cookies_brown_sugar", "qty": 1, "name": "light brown sugar", "note": "packed", "text": null, "unit": "cup"}, {"id": "cookies_vanilla", "qty": 2, "name": "pure vanilla extract", "note": null, "text": null, "unit": "tsp"}, {"id": "cookies_eggs", "qty": 2, "name": "large eggs", "note": null, "text": null, "unit": null}, {"id": "cookies_flour", "qty": 3, "name": "all-purpose flour", "note": null, "text": null, "unit": "cup"}, {"id": "cookies_baking_soda", "qty": 1, "name": "baking soda", "note": null, "text": null, "unit": "tsp"}, {"id": "cookies_baking_powder", "qty": 0.5, "name": "baking powder", "note": null, "text": null, "unit": "tsp"}, {"id": "cookies_salt", "qty": 1, "name": "sea salt", "note": null, "text": null, "unit": "tsp"}, {"id": "cookies_chocolate_chips", "qty": 2, "name": "chocolate chips", "note": null, "text": null, "unit": "cup"}]}], "servings": 36, "sourceUrl": "https://joyfoodsunshine.com/the-most-amazing-chocolate-chip-cookies/", "yieldText": "36 cookies"}	[]	36	2026-08-08 11:28:06.763359+00	2026-08-08 17:24:17.981+00	diagram	\N	\N	private	\N
r1785611431265	1dd52504-f9b9-4acc-b757-efceb4f8dea0	{"title": "Chewy Chocolate Chip Cookies", "source": "Sally's Baking", "sections": [{"name": "Cookies", "root": "cookie_10", "nodes": [{"id": "cookie_1", "label": "whisk dry ingredients in a separate bowl", "tempF": null, "inputs": ["cookie_flour", "cookie_baking_soda", "cookie_cornstarch", "cookie_salt"], "minutes": null}, {"id": "cookie_2", "label": "whisk butter and sugars", "tempF": null, "inputs": ["cookie_butter", "cookie_brown_sugar", "cookie_granulated_sugar"], "minutes": null}, {"id": "cookie_3", "label": "whisk in egg and yolk", "tempF": null, "inputs": ["cookie_2", "cookie_egg", "cookie_egg_yolk"], "minutes": null}, {"id": "cookie_4", "label": "whisk in vanilla", "tempF": null, "inputs": ["cookie_3", "cookie_vanilla"], "minutes": null}, {"id": "cookie_5", "label": "mix wet into dry", "tempF": null, "inputs": ["cookie_1", "cookie_4"], "minutes": null}, {"id": "cookie_6", "label": "fold in chocolate chips", "tempF": null, "inputs": ["cookie_5", "cookie_chocolate_chips"], "minutes": null}, {"id": "cookie_7", "label": "chill 2 hr", "tempF": null, "inputs": ["cookie_6"], "minutes": 120}, {"id": "cookie_8", "label": "scoop and shape dough", "tempF": null, "inputs": ["cookie_7"], "minutes": null}, {"id": "cookie_9", "label": "bake 325°F 13 min", "tempF": 325, "inputs": ["cookie_8"], "minutes": 13}, {"id": "cookie_10", "label": "cool 10 min", "tempF": null, "inputs": ["cookie_9"], "minutes": 10}], "header": "Oven 325°F", "ingredients": [{"id": "cookie_flour", "qty": 2.25, "name": "all-purpose flour", "note": "spooned & leveled", "text": null, "unit": "cup", "qtyMax": null}, {"id": "cookie_baking_soda", "qty": 1, "name": "baking soda", "note": null, "text": null, "unit": "tsp", "qtyMax": null}, {"id": "cookie_cornstarch", "qty": 1.5, "name": "cornstarch", "note": null, "text": null, "unit": "tsp", "qtyMax": null}, {"id": "cookie_salt", "qty": 0.5, "name": "salt", "note": null, "text": null, "unit": "tsp", "qtyMax": null}, {"id": "cookie_butter", "qty": 0.75, "name": "unsalted butter", "note": "melted & cooled for 5 minutes", "text": null, "unit": "cup", "qtyMax": null}, {"id": "cookie_brown_sugar", "qty": 0.75, "name": "brown sugar", "note": "packed, light or dark", "text": null, "unit": "cup", "qtyMax": null}, {"id": "cookie_granulated_sugar", "qty": 0.5, "name": "granulated sugar", "note": null, "text": null, "unit": "cup", "qtyMax": null}, {"id": "cookie_egg", "qty": 1, "name": "large egg", "note": "room temperature", "text": null, "unit": null, "qtyMax": null}, {"id": "cookie_egg_yolk", "qty": 1, "name": "egg yolk", "note": "room temperature", "text": null, "unit": null, "qtyMax": null}, {"id": "cookie_vanilla", "qty": 2, "name": "pure vanilla extract", "note": null, "text": null, "unit": "tsp", "qtyMax": null}, {"id": "cookie_chocolate_chips", "qty": 1.25, "name": "semi-sweet chocolate chips or chunks", "note": null, "text": null, "unit": "cup", "qtyMax": null}]}], "servings": null, "sourceUrl": "https://sallysbakingaddiction.com/chewy-chocolate-chip-cookies/", "yieldText": "16 XL cookies or 20 medium/large cookies"}	["cookie_2", "cookie_butter", "cookie_brown_sugar", "cookie_granulated_sugar", "cookie_3", "cookie_egg", "cookie_egg_yolk", "cookie_1", "cookie_flour", "cookie_baking_soda", "cookie_cornstarch", "cookie_salt"]	\N	2026-08-08 23:29:28.841634+00	2026-08-08 23:32:47.690699+00	steps	\N	\N	private	\N
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sessions (id_hash, user_id, created_at, last_seen_at, expires_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, display_name, email, created_at) FROM stdin;
\.


--
-- Name: auth_states auth_states_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auth_states
    ADD CONSTRAINT auth_states_pkey PRIMARY KEY (state);


--
-- Name: extraction_cache extraction_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.extraction_cache
    ADD CONSTRAINT extraction_cache_pkey PRIMARY KEY (hash);


--
-- Name: identities identities_provider_subject_pk; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.identities
    ADD CONSTRAINT identities_provider_subject_pk PRIMARY KEY (provider, subject);


--
-- Name: recipes recipes_owner_key_id_pk; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.recipes
    ADD CONSTRAINT recipes_owner_key_id_pk PRIMARY KEY (owner_key, id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id_hash);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: auth_states_expires_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX auth_states_expires_idx ON public.auth_states USING btree (expires_at);


--
-- Name: identities_user_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX identities_user_idx ON public.identities USING btree (user_id);


--
-- Name: recipes_owner_updated_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX recipes_owner_updated_idx ON public.recipes USING btree (owner_key, updated_at);


--
-- Name: recipes_share_slug_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX recipes_share_slug_unique ON public.recipes USING btree (share_slug) WHERE (share_slug IS NOT NULL);


--
-- Name: recipes_user_id_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX recipes_user_id_unique ON public.recipes USING btree (user_id, id) WHERE (user_id IS NOT NULL);


--
-- Name: recipes_user_updated_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX recipes_user_updated_idx ON public.recipes USING btree (user_id, updated_at);


--
-- Name: sessions_expires_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sessions_expires_idx ON public.sessions USING btree (expires_at);


--
-- Name: sessions_user_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sessions_user_idx ON public.sessions USING btree (user_id);


--
-- Name: identities identities_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.identities
    ADD CONSTRAINT identities_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict NA303QfDLBkIzgKuiPCU4ENfGHZkmmrzXFOAEpol75rNITHeG4FQiVIfugCf7OG

