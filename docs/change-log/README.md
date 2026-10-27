# MealCare change log

Every change to a baselined artefact goes through one process. Each change request is also recorded as a GitHub issue with the `change-request` label.

**1 Generate → 2 Log → 3 Evaluate → 4 Authorize → 5 Implement**

**Change Control Board:** Aanya Sancheti (PM, chair) · Adit Dahiya (Lead Dev & QA) · Saanvi Rajkumar (Release) · Sponsor for scope changes

| CR | Date | Change | Affects | Priority | Status | Notes |
|---|---|---|---|---|---|---|
| [CR-001](CR-001.md) | 25 Sep 2026 | Replace the Nutritionix nutrition database with the USDA FoodData Central API | Scope, Cost, External Interface | High | Closed | Approved. Removes a SGD 350 monthly licence and the only paid nutrition dependency. SRS Sections 5 and 6, the proposal budget and all sequence diagrams revised. |
| [CR-002](CR-002.md) | 21 Sep 2026 | Add Delete Account and Account Recovery as use cases 18 and 19 | Scope, Product, Security and Privacy | High | Closed | Approved. Required to meet the retention and deletion obligations in Section 6.5 of the SRS. Sequence diagrams produced; use case table entries outstanding. |
| [CR-003](CR-003.md) | 13 Oct 2026 | Align risk identifiers between the Project Plan and the Risk Management Plan | Processes, Deliverables | Medium | Closed | Approved. The two registers used the same identifiers for different risks. The Project Plan was renumbered to the Risk Management Plan's identifiers; no risk content changed. |
| [CR-004](CR-004.md) | 13 Oct 2026 | Add an in-app AI help assistant reachable from the chat icon | Scope, Product, Time | Medium | Work in Progress | Approved with re-estimation. Unadjusted function points 201 to 219, effort 151 to 164 PD. Risk R13 opened. The schedule surplus recorded in Section 5.2 of the Project Plan is consumed by this change. |
| [CR-005](CR-005.md) | 20 Oct 2026 | Seed a curated reference table of common local hawker dishes | Scope, Product, Quality | Medium | Open | Under evaluation. Would reduce risk R1, the highest-exposure risk in the register. Estimated at 3 PD, for which the board must identify an equivalent deferral. |
| [CR-006](CR-006.md) | 20 Oct 2026 | Add a portion size selector to the meal logging screen | Product, Quality | Low | Deferred | Deferred to the post-project backlog. Accepted as the largest accuracy gain per person-day available, but no capacity remains in X07 after CR-004. |
