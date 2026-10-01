-- STAGING ONLY. Reviewed mapping of real tracked campuses to the imported directory's
-- IPEDS UNITID. Does not identify the directory import vintage/open-campus status:
-- that provenance remains a separate release blocker. The synthetic monitor fixture
-- intentionally has no federal identity and must never consume a real college unit.
-- Run via the staging Supabase migration tool, never against Production.
-- Reversal, if needed after backup/review: drop the two named constraints and unique
-- index, then clear only these ten exact institution_id mappings. Coverage rows are
-- append-only and are NOT deleted/re-keyed by reversal.
DO $identity$
DECLARE r record; matched integer := 0;
BEGIN
  FOR r IN
    SELECT m.*, i.id AS institution_id, d.unitid AS directory_unitid,
           d.institution_id AS old_institution_id
    FROM (VALUES
      ('alabama','100751','The University of Alabama','Tuscaloosa','AL','ua.edu'),
      ('arizona','104179','University of Arizona','Tucson','AZ','arizona.edu'),
      ('arkansas','106397','University of Arkansas','Fayetteville','AR','uark.edu'),
      ('grand-valley-state','170082','Grand Valley State University','Allendale','MI','gvsu.edu'),
      ('michigan-state','171100','Michigan State University','East Lansing','MI','msu.edu'),
      ('oklahoma','207500','University of Oklahoma-Norman Campus','Norman','OK','ou.edu'),
      ('texas-am','228723','Texas A&M University-College Station','College Station','TX','tamu.edu'),
      ('ut-austin','228778','The University of Texas at Austin','Austin','TX','utexas.edu'),
      ('ut-dallas','228787','The University of Texas at Dallas','Richardson','TX','utdallas.edu'),
      ('western-michigan','172699','Western Michigan University','Kalamazoo','MI','wmich.edu')
    ) AS m(slug,unitid,name,city,state,domain)
    LEFT JOIN institutions i ON i.slug=m.slug
    LEFT JOIN school_directory d ON d.unitid=m.unitid AND d.name=m.name
        AND d.city=m.city AND d.state=m.state AND d.domain=m.domain
  LOOP
    IF r.institution_id IS NULL OR r.directory_unitid IS NULL OR
       (r.old_institution_id IS NOT NULL AND r.old_institution_id<>r.institution_id) OR
       EXISTS(SELECT 1 FROM school_directory WHERE institution_id=r.institution_id AND unitid<>r.unitid)
    THEN RAISE EXCEPTION 'UNITID mapping preflight failed for slug %',r.slug;
    END IF;
    UPDATE school_directory SET institution_id=r.institution_id
      WHERE unitid=r.unitid AND (institution_id IS NULL OR institution_id=r.institution_id);
    matched := matched+1;
  END LOOP;
  IF matched<>10 THEN RAISE EXCEPTION 'Expected ten campus identity mappings; found %', matched; END IF;
END
$identity$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_school_directory_institution_unitid
  ON school_directory(institution_id) WHERE institution_id IS NOT NULL;
ALTER TABLE school_directory ADD CONSTRAINT ck_school_directory_six_digit_unitid
  CHECK (unitid ~ '^[0-9]{6}$');
ALTER TABLE college_coverage_colleges ADD CONSTRAINT ck_coverage_federal_unitid
  CHECK (college_id ~ '^[0-9]{6}$');
ALTER TABLE college_coverage_colleges ADD CONSTRAINT fk_coverage_federal_unitid
  FOREIGN KEY (college_id) REFERENCES school_directory(unitid);
