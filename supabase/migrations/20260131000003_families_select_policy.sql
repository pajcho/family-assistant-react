-- Allow users to view their own family data
CREATE POLICY "Members can view own family" ON families FOR SELECT
  USING (id IN (SELECT family_id FROM profiles WHERE profiles.id = auth.uid()));
