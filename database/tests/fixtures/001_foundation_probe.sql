-- Up Migration
CREATE TABLE public.foundation_probe (id integer PRIMARY KEY);
INSERT INTO public.foundation_probe (id) VALUES (1);

-- Down Migration
DROP TABLE public.foundation_probe;
