// Resolves the original variation's template literals into the final
// HTML payload that goes into Optimizely Visual Editor Change 1.
//
// This is the variation source from project 19741965684, experiment
// 6686084654956544, variation 6298220561694720 — copied verbatim except
// for the modifyElementWithCallback call at the bottom, which is the
// runtime delivery; we only need the resolved HTML strings here.

const fs = require('fs');
const path = require('path');

const rightArrowSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="25" viewBox="0 0 24 25" fill="none"><path d="M3.10352 12.8257C3.10352 12.2734 3.55123 11.8257 4.10352 11.8257H17.4819L14.2369 8.58064C13.8464 8.19012 13.8464 7.55695 14.2369 7.16643C14.6274 6.7759 15.2606 6.7759 15.6511 7.16643L20.6028 12.1181C20.7699 12.2852 20.8655 12.4966 20.8896 12.7145C20.9219 13.006 20.8263 13.309 20.6028 13.5325L15.6514 18.484C15.2608 18.8745 14.6277 18.8745 14.2371 18.484C13.8466 18.0934 13.8466 17.4603 14.2371 17.0697L17.4812 13.8257H4.10352C3.55123 13.8257 3.10352 13.378 3.10352 12.8257Z" fill="#004FCB"/></svg>`;

const faqSection = `<div class="opt-faq-section" id="opt1399FAQ"><style>.opt-faq-section{max-width:1200px;margin:auto}.opt-faq-section .opt-faq-header-text{font-weight:320;font-size:56px;line-height:112%;color:#2d2d2d}.opt-faq-section .opt-faq-header-partial-border{border-top:2px solid #c7d2f6;margin-top:20px;width:181px}.opt-faq-section .opt-faq-content-flex{display:flex;width:100%;gap:60px;margin-top:50px}.opt-faq-section .opt-faq-content-list{display:flex;flex:1;flex-direction:column}.opt-faq-section .xds-faq-question-btn{display:-ms-flexbox;display:flex;-ms-flex-direction:row;flex-direction:row;-ms-flex-align:center;align-items:center;-ms-flex-pack:justify;justify-content:space-between;gap:1rem;background-color:transparent;padding-left:0;padding-top:1.375rem;padding-bottom:1.375rem;font-weight:500;transform:scale(1);transition:all .2s ease 0s;padding-block:1.5rem 2rem;border-right:none;border-left:none;border-bottom:none;border-top:2px solid #e4e2e0;cursor:pointer;font-family:"Indeed Sans","Noto Sans","Helvetica Neue",Helvetica,Arial,"Liberation Sans",Roboto,Noto,sans-serif}.opt-faq-section .xds-faq-question{font-size:24px;font-weight:460;line-height:1.25;color:#2d2d2d;text-align:left;max-width:90%;font-family:"Indeed Sans","Noto Sans","Helvetica Neue",Helvetica,Arial,"Liberation Sans",Roboto,Noto,sans-serif}.opt-faq-section .xds-faq-question-chevron{inline-size:1.5rem;block-size:1.5rem;background-image:url('data:image/svg+xml,<svg width="24" height="25" viewBox="0 0 24 25" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18.0015 15.0411C18.2017 15.2413 18.2056 15.5618 18.0104 15.7571L17.3033 16.4642C17.108 16.6595 16.7874 16.6555 16.5873 16.4553L12 11.868L7.41297 16.455C7.21258 16.6554 6.89184 16.6596 6.69658 16.4643L5.98947 15.7572C5.79421 15.5619 5.79837 15.2412 5.99876 15.0408L11.6464 9.39315C11.7467 9.29282 11.8802 9.24509 12.0133 9.24955C12.1375 9.25189 12.2599 9.29966 12.3534 9.39323L12.3543 9.39405C12.357 9.39668 12.3597 9.39934 12.3624 9.40204L18.0015 15.0411Z" fill="%232D2D2D"/></svg>');transform:rotate(0);transition:transform .2s cubic-bezier(0,0,1,1) 0s;min-width:24px}.opt-faq-section .xds-faq-question-btn.active .xds-faq-question-chevron{transform:rotate(180deg)}.opt-faq-section .xds-faq-question-btn.active+.xds-faq-answer{max-height:-moz-fit-content;max-height:fit-content;font-size:1.25rem;line-height:1.5;font-weight:400;color:#2d2d2d;padding-bottom:3rem}.opt-faq-section .opt-hyperlink{font-size:1.25rem;line-height:1.5;margin-top:1.5rem}.opt-faq-section .xds-faq-answer{max-height:0;overflow:hidden}.opt-faq-section .opt-hyperlink svg{transform:translateY(2px)}@media only screen and (max-width:1280px){.opt-faq-section .opt-faq-header-text{font-weight:355;font-size:32px;line-height:125%}.opt-faq-section .opt-faq-header-partial-border{border-top:2px solid #c7d2f6;margin-top:20px;width:119px}.opt-faq-section .opt-faq-content-flex{flex-direction:column;gap:0}.opt-faq-section .xds-faq-question{font-weight:460;font-size:20px;line-height:125%}.opt-faq-section .xds-faq-question-btn.active+.xds-faq-answer{font-size:1.125rem}.opt-faq-section .opt-hyperlink{font-size:1.125rem}}</style><div class="opt-faq-header"><div class="opt-faq-header-text">FAQ</div><div class="opt-faq-header-partial-border"></div></div><div class="opt-faq-content-flex"><div class="opt-faq-content-list"><button class="xds-faq-question-btn" id="xds-faq-question-btn-0"><span class="xds-faq-question">Can I post a job for free on Indeed?</span> <span class="xds-faq-question-chevron"></span></button><div class="xds-faq-answer" aria-labelledby="xds-faq-question-btn-0" aria-hidden="true">Yes. Many jobs can be posted for free, subject to Indeed's terms, conditions, quality standards, and usage limits. Feature availability for Free job posts is limited and is subject to change at Indeed's discretion. It should be noted that some jobs are considered “sponsored only,” which will be made clear in the product. Some examples of job postings that may require sponsoring include: jobs aggregated directly from a career site or company website, published jobs from a data feed (e.g., XML, API), or published jobs from an Applicant Tracking System (ATS). Indeed reserves the right to require that a job must be sponsored for any reason. <a class="opt-hyperlink" href="https://www.indeed.com/legal#adsprogram">Review Ad Terms ${rightArrowSVG}</a></div><button class="xds-faq-question-btn" id="xds-faq-question-btn-1"><span class="xds-faq-question">What's the minimum price I can set for a Sponsored Job on Indeed?</span> <span class="xds-faq-question-chevron"></span></button><div class="xds-faq-answer" aria-labelledby="xds-faq-question-btn-1" aria-hidden="true">The minimum price will appear on the product sponsorship page and will depend on several factors, including available job seekers in your market, similar job posts bidding for priority placement, the type of Sponsored Jobs plan you select, among others.</div><button class="xds-faq-question-btn" id="xds-faq-question-btn-2"><span class="xds-faq-question">How does Indeed set the Standard price?</span> <span class="xds-faq-question-chevron"></span></button><div class="xds-faq-answer" aria-labelledby="xds-faq-question-btn-2" aria-hidden="true">The Standard price is generated based on Indeed's recommendation system, which takes into account market factors such as job competitiveness, your hiring timeline and the supply of job seekers for specific job titles, among other factors.</div><button class="xds-faq-question-btn" id="xds-faq-question-btn-3"><span class="xds-faq-question">How does Indeed set the Premium price?</span> <span class="xds-faq-question-chevron"></span></button><div class="xds-faq-answer" aria-labelledby="xds-faq-question-btn-3" aria-hidden="true">The Premium price is set above the Standard price to help ensure more applications from quality candidates quickly compared to Standard Sponsored Jobs. This way, your Premium Sponsored Job is competitive against similar roles on Indeed.</div><button class="xds-faq-question-btn" id="xds-faq-question-btn-4"><span class="xds-faq-question">Do I have to accept the price that Indeed recommends?</span> <span class="xds-faq-question-chevron"></span></button><div class="xds-faq-answer" aria-labelledby="xds-faq-question-btn-4" aria-hidden="true">No. You're free to set a different amount as long as it meets the minimum required for that job.</div></div><div class="opt-faq-content-list"><button class="xds-faq-question-btn" id="xds-faq-question-btn-5"><span class="xds-faq-question">When will I be billed for my Sponsored Job?</span> <span class="xds-faq-question-chevron"></span></button><div class="xds-faq-answer" aria-labelledby="xds-faq-question-btn-5" aria-hidden="true">You'll be billed on the first day of the month or when your account spending reaches $500—whichever comes first. Your invoice will reflect the amount spent on job seeker interactions like clicks or started applications from the previous billing period.</div><button class="xds-faq-question-btn" id="xds-faq-question-btn-6"><span class="xds-faq-question">Can I make changes to the Sponsored Job budget after I've posted the job?</span> <span class="xds-faq-question-chevron"></span></button><div class="xds-faq-answer" aria-labelledby="xds-faq-question-btn-6" aria-hidden="true">You can make changes to the Sponsored Job budget from the employer dashboard by selecting “Manage Budget” from the job list.</div><button class="xds-faq-question-btn" id="xds-faq-question-btn-7"><span class="xds-faq-question">How are Matched Candidates through Premium Sponsored Jobs different from the ones I have in my Smart Sourcing subscription?</span> <span class="xds-faq-question-chevron"></span></button><div class="xds-faq-answer" aria-labelledby="xds-faq-question-btn-7" aria-hidden="true">Access to Matched Candidates through Premium Sponsored Jobs is limited to a specific job and can be accessed through your Candidates tab in the employer dashboard. Premium Sponsored Jobs also have a daily Matched Candidate contact limit. For access to additional contacts that can be used across all jobs, consider a <a style="color:#004fcb!important" href="https://resumes.indeed.com/purchase">Smart Sourcing subscription</a></div><button class="xds-faq-question-btn" id="xds-faq-question-btn-8"><span class="xds-faq-question">If I invite candidates to apply for my Premium Sponsored Job using my Premium Matched Candidates contacts, does that get deducted from my Smart Sourcing contact credits? </span><span class="xds-faq-question-chevron"></span></button><div class="xds-faq-answer" aria-labelledby="xds-faq-question-btn-8" aria-hidden="true">No. Premium Sponsored Jobs contacts will not be deducted from your Smart Sourcing contact credits</div></div></div></div>`;

const hireMoreSection = `<div class="opt-hire-more-section"><style>.opt-hire-more-section{max-width:1200px;margin:auto;background-image:url('data:image/svg+xml,<svg width="1158" height="276" viewBox="0 0 1158 276" fill="none" xmlns="http://www.w3.org/2000/svg"><g opacity="0.67" filter="url(%23filter0_d_2753_7587)"><path d="M80 590.429C80 590.429 202.379 53.4244 463.989 177.299C851.34 360.712 777.652 78.1387 1028.58 28.6916C1279.51 -21.0213 1585.58 376.158 1562.8 590.429H80Z" fill="%23F7F9FF"/></g><defs><filter id="filter0_d_2753_7587" x="0" y="-55.5713" width="1644" height="726" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/><feOffset/><feComposite in2="hardAlpha" operator="out"/><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.5 0"/><feBlend mode="overlay" in2="BackgroundImageFix" result="effect1_dropShadow_2753_7587"/><feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_2753_7587" result="shape"/></filter></defs></svg>'),linear-gradient(212.62deg,#ecf2ff 5%,#d7e3ff 95%);background-position-y:bottom;background-repeat:no-repeat;background-size:cover;padding:48px 60px;display:flex;flex-direction:column;align-items:center}.opt-hire-more-section-header{font-weight:715;font-size:28px;line-height:125%;letter-spacing:0;text-align:center;color:#2d2d2d}.opt-hire-more-section-desc{font-weight:300;font-size:24px;line-height:115%;text-align:center;color:#2d2d2d;margin:24px 0}.opt-hire-more-section .card-button-cta{margin-top:32px;justify-content:center;background-color:#004fcb!important;font-weight:700;font-size:16px;line-height:113%}@media only screen and (max-width:1280px){.opt-hire-more-section{padding:48px 16px;background-image:url('data:image/svg+xml,<svg width="400" height="266" viewBox="0 0 400 266" fill="none" xmlns="http://www.w3.org/2000/svg"><g opacity="0.67" filter="url(%23filter0_d_2753_7008)"><path d="M0 319.929C0 319.929 51.9534 93.1725 163.014 145.48C327.456 222.928 296.173 103.608 402.7 82.7288C509.227 61.7369 639.162 229.45 629.49 319.929H0Z" fill="%23F7F9FF"/></g><defs><filter id="filter0_d_2753_7008" x="-80" y="0.928711" width="790" height="399" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/><feOffset/><feComposite in2="hardAlpha" operator="out"/><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.5 0"/><feBlend mode="overlay" in2="BackgroundImageFix" result="effect1_dropShadow_2753_7008"/><feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_2753_7008" result="shape"/></filter></defs></svg>'),linear-gradient(212.62deg,#ecf2ff 5%,#d7e3ff 95%)}}</style><div class="opt-hire-more-section-header">Hire more and faster</div><div class="opt-hire-more-section-desc">Do your high-volume hiring all in one place.</div><a class="card-button-cta opt-1399-hmaf-lm" href="https://www.indeed.com/employers/o/enterprise"><span>Learn more</span></a></div>`;

const exploreMoreSection = `<div class="opt-explore-more-section"><style>.opt-explore-more-section{display:flex;gap:80px;max-width:1200px;align-items:center;margin:50px auto 100px auto}.opt-explore-more-text{width:40%;padding-left:58px}.opt-explore-more-text .opt-hyperlink{margin-top:32px}@media only screen and (max-width:1280px){.opt-explore-more-section{flex-direction:column-reverse;gap:40px;margin-top:0;margin-bottom:50px}.opt-explore-more-text{width:100%;padding:24px 48px 0 48px}section.mobile-no-padding{padding:48px 0}}@media only screen and (max-width:700px){.opt-explore-more-visual{background-size:cover!important}}.opt-explore-more-eyebrow{font-weight:750;font-size:16px;line-height:115%;letter-spacing:2px;text-transform:uppercase;color:#996e2c}.opt-explore-more-header{font-weight:460;font-size:24px;line-height:125%;letter-spacing:0;margin:24px 0;color:#2d2d2d}.opt-explore-more-copy{font-weight:400;font-size:20px;line-height:150%;letter-spacing:0;color:#595959}.opt-explore-more-visual{display:flex;gap:16px;flex-direction:column;align-items:center;background-image:url('data:image/svg+xml,<svg width="610" height="456" viewBox="0 0 610 456" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M389.87 411.206C551.446 336.506 644.566 194.07 597.858 93.0673C551.151 -7.93596 382.303 -29.2591 220.727 45.4408C59.1505 120.141 -33.9691 262.576 12.7384 363.579C59.4459 464.582 228.293 485.906 389.87 411.206Z" fill="url(%23paint0_linear_2753_7762)"/><defs><linearGradient id="paint0_linear_2753_7762" x1="-0.713201" y1="334.441" x2="524.489" y2="-10.129" gradientUnits="userSpaceOnUse"><stop stop-color="%23E0A961"/><stop offset="1" stop-color="%23C08A38"/></linearGradient></defs></svg>');background-size:contain;background-repeat:no-repeat;background-position:center;flex:1;padding:48px 0;width:100%}.visual-card{width:360px;border-radius:7px;padding:24px;background-color:#fff;box-shadow:0 4px 8px 0 rgba(0,0,0,.25)}@media only screen and (max-width:1280px){.visual-card{width:calc(100% - 84px);max-width:360px}}.visual-menu-tabs{display:flex;width:100%;margin-bottom:12px}.visual-left-tab{font-weight:400;font-size:12px;line-height:125%;color:#595959;border-bottom:1px solid #595959;flex:1;text-align:center;padding-bottom:8px}.visual-right-tab{border-bottom:3.5px solid #2d2d2d;color:#2d2d2d;font-weight:700;font-size:12px;line-height:125%;flex:1;text-align:center;padding-bottom:8px}.visual-menu-tabs-bottom{font-weight:400;font-size:12px;line-height:125%;letter-spacing:0;text-align:center;color:#2d2d2d;margin-bottom:2px}.visual-menu-employee{display:flex;flex-direction:column;gap:16px}.visual-menu-employee-name{font-weight:700;font-size:16px;line-height:125%;letter-spacing:-.43px;color:#2d2d2d}.visual-menu-employee-name span{color:#595959;font-weight:400;font-size:12px;line-height:125%;margin-left:7px}.visual-menu-employee-details .visual-title{font-weight:700;font-size:12px;line-height:125%;color:#2d2d2d}.visual-menu-employee-details .visual-description{font-weight:400;font-size:12px;line-height:125%;color:#595959;margin-top:3px}.visual-menu-employee-details .visual-pills{margin-top:3px;display:flex;gap:6px}.visual-menu-employee-details .visual-pills .visual-pill{font-weight:700;font-size:10px;line-height:125%;color:#767676;border:1px solid #d4d2d0;border-radius:3.5px;padding:3.5px 7px}.message-button{display:flex;width:100%;justify-content:center;margin-bottom:4px;padding:8px 16px;color:#fff;background-color:#004fcb;border-radius:8px;height:36px;font-family:Font/Family/default;font-weight:700;line-height:100%;font-size:16px;align-items:center;gap:8px}.active-today{font-weight:400;font-size:12px;line-height:125%;color:#2d2d2d;display:flex;gap:10px;align-items:center}</style><div class="opt-explore-more-text"><div class="opt-explore-more-eyebrow">Explore more with smart sourcing</div><div class="opt-explore-more-header">Search resumes to find and connect with the right candidates</div><div class="opt-explore-more-copy">Indeed Smart Sourcing helps you find and connect with the right candidates instantly by combining the power of built-in matching technology with the ability to search resumes.</div><a class="opt-hyperlink opt-1399-em-saa" href="https://resumes.indeed.com/purchase">Start a trial ${rightArrowSVG}</a></div><div class="opt-explore-more-visual"><div class="visual-card"><div class="visual-menu-tabs"><div class="visual-left-tab">Match candidates by job</div><div class="visual-right-tab">Search for candidates</div></div><div class="visual-menu-tabs-bottom">116 resumes match your criteria</div></div><div class="visual-card"><div class="visual-menu-employee"><div class="visual-menu-employee-name">Alyssa Vega <span>Austin, TX</span></div><div class="visual-menu-employee-details"><div class="visual-title">Pediatric Registered Nurse</div><div class="visual-description">A&L Medical Center, 2020 - present</div></div><div class="visual-menu-employee-details"><div class="visual-title">Education</div><div class="visual-description">Bachelor's Degree, Brandt College</div></div><div class="visual-menu-employee-details"><div class="visual-title">Skils</div><div class="visual-pills"><div class="visual-pill">EMR systems</div><div class="visual-pill">Nursing</div><div class="visual-pill">Vital signs</div></div></div><div class="message-button"><svg width="21" height="21" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M3.83329 5.78581H17.1666V15.7858H3.83329V5.78581ZM2.16663 5.78581C2.16663 4.86533 2.91282 4.11914 3.83329 4.11914H17.1666C18.0871 4.11914 18.8333 4.86533 18.8333 5.78581V15.7858C18.8333 16.7063 18.0871 17.4525 17.1666 17.4525H3.83329C2.91282 17.4525 2.16663 16.7063 2.16663 15.7858V5.78581ZM5.87339 7.10534C5.4983 6.83865 4.97803 6.92652 4.71134 7.30162C4.44465 7.67671 4.53252 8.19698 4.90761 8.46367L9.84416 11.9736C10.2829 12.2855 10.872 12.2815 11.3065 11.9637L16.1004 8.4571C16.4719 8.18538 16.5527 7.66398 16.281 7.29251C16.0093 6.92105 15.4879 6.84019 15.1164 7.11191L10.565 10.4411L5.87339 7.10534Z" fill="white"/></svg> Message</div><div class="active-today"><svg width="18" height="19" viewBox="0 0 18 19" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M4.23009 6.48033C3.92398 6.19648 3.75 5.7979 3.75 5.38043V3.78516C3.75 2.95673 4.42157 2.28516 5.25 2.28516H12.75C13.5784 2.28516 14.25 2.95673 14.25 3.78516V5.38043C14.25 5.7979 14.076 6.19648 13.7699 6.48033L10.2086 9.78268L13.7707 13.0904C14.0763 13.3742 14.25 13.7725 14.25 14.1896V15.7854C14.25 16.6139 13.5784 17.2854 12.75 17.2854H5.25C4.42157 17.2854 3.75 16.6139 3.75 15.7854V14.1896C3.75 13.7725 3.92367 13.3742 4.22932 13.0904L7.79145 9.78268L4.23009 6.48033ZM12.75 14.1896V15.7854H5.25L5.25 14.1896L9 10.7074L12.75 14.1896Z" fill="#2D2D2D"/></svg> Active today</div></div></div></div></div>`;

const _1399_contents = `<style>[data-tn-page="/hire/cs/pricing"] [data-tn-section=main],body:not([data-tn-page="/hire/cs/pricing"]) main>div:last-child{display:none!important}.opt-hyperlink{margin-top:24px;color:#004fcb!important;font-size:16px;font-weight:500;display:flex;gap:8px;text-decoration:none!important}.opt-moo-1399 .card-button-cta{box-sizing:border-box;background:none #2557a7;appearance:none;text-align:start;text-decoration:none;border:none;cursor:pointer;user-select:none;align-items:center;justify-content:flex-start;position:relative;margin-block:0;margin-inline:0;padding-inline:1rem;line-height:1.5;font-family:"Indeed Sans","Noto Sans","Helvetica Neue",Helvetica,Arial,"Liberation Sans",Roboto,Noto,sans-serif;font-size:1rem;font-weight:700;border-radius:.5rem;transition:border-color .2s cubic-bezier(.645,.045,.355,1),background-color .2s cubic-bezier(.645,.045,.355,1),opacity .2s cubic-bezier(.645,.045,.355,1),box-shadow .2s cubic-bezier(.645,.045,.355,1),color .2s cubic-bezier(.645,.045,.355,1),z-index .2s cubic-bezier(.645,.045,.355,1);inline-size:auto;padding-block:.5625rem;min-block-size:2.75rem;color:#fff;width:139px;display:flex;gap:7px;height:56px}.opt-moo-1399 section{padding:50px}@media only screen and (max-width:1280px){.opt-moo-1399 section{padding:42px}}</style><div class="opt-moo-1399"><section>${faqSection}</section><section>${hireMoreSection}</section><section class="mobile-no-padding">${exploreMoreSection}</section></div>`;

const jobPostLink = `https://employers.indeed.com/p/posting?isid=ews-pricing&ikw=hero-cta&from=ews-pricing-hero-cta`;

const _1445_contents = `
<div id="opt-1445">
    <section class="tier">
        <div class="container">
            <h1 class="tier__headline">Sponsored Job plans</h1>
            <p class="tier__subtitle">Get increased visibility with a Sponsored Job plan. You can cancel at any time.
            </p>
            <div class="tier__list">
                <div class="tier__item core">
                    <div class="tier__pin"></div>
                    <div class="tier__title">Free
                        <input type="checkbox" id="core">
                        <label for="core"><sup>1</sup></label>
                        <div class="tooltip">
                            <div class="title">1</div>
                            <label for="core" class="close"></label>
                            <div class="content">Terms, conditions, quality standards, and usage limits apply. Feature
                                availability may vary by job and by market, and is subject to change at Indeed's
                                discretion.
                            </div>
                        </div>
                    </div>
                    <div class="tier__badge"></div>
                    <div class="tier__description">Get on-demand market and candidate data specific to your role and
                        location.</div>
                    <div class="tier__features">
                        <div class="feature_title">Included features:</div>
                        <div class="feature_item">Include your post in search results</div>
                        <div class="feature_item">Manage your candidates on Indeed</div>
                    </div>
                    <div class="tier__action">
                        <a href="${jobPostLink}">Post a job</a>
                    </div>
                </div>
                <div class="tier__item blue">
                    <div class="tier__pin">Popular</div>
                    <div class="tier__title">Standard</div>
                    <div class="tier__badge">4X more applicants than free
                        <input type="checkbox" id="blue">
                        <label for="blue"></label>
                        <div class="tooltip">
                            <div class="title">Standard</div>
                            <label for="blue" class="close"></label>
                            <div class="content">Sponsored Jobs posted directly on Indeed have 4X more applications than
                                non-sponsored jobs. For hosted jobs only. Indeed data (US)</div>
                        </div>
                    </div>
                    <div class="tier__description">Increased visibility gets your job in front of more people.</div>
                    <div class="tier__features">
                        <div class="feature_title">Everything in Free, and:</div>
                        <div class="feature_item dashed">
                            <input type="checkbox" id="visibility-boost">
                            <label for="visibility-boost">Visibility boost</label>
                            <div class="tooltip">
                                <div class="title">Visibility boost</div>
                                <label for="visibility-boost" class="close"></label>
                                <div class="content">Prioritize your Sponsored Job over free<sup>1</sup> job posts in
                                    relevant search results, so it's seen by active job seekers.</div>
                            </div>
                        </div>
                        <div class="feature_item dashed">
                            <input type="checkbox" id="automated-messages">
                            <label for="automated-messages">Automated messages</label>
                            <div class="tooltip">
                                <div class="title">Automated messages</div>
                                <label for="automated-messages" class="close"></label>
                                <div class="content">Connect with candidates when they apply to your job, are added to
                                    your shortlist, or you reject an application from the employer dashboard.</div>
                            </div>
                        </div>
                        <div class="feature_item">No long-term contracts</div>
                        <div class="feature_item">You set the ad duration</div>
                    </div>
                    <div class="tier__action">
                        <a href="${jobPostLink}">Post a job</a>
                    </div>
                </div>
                <div class="tier__item gold">
                    <div class="tier__pin"></div>
                    <div class="tier__title"><svg width="33" height="33" viewBox="0 0 33 33" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11.3181 29.0818H6.87068C6.06101 29.0818 5.37401 28.7993 4.80967 28.2343C4.24559 27.6691 3.96355 26.981 3.96355 26.1701V21.7157L0.830008 18.5642C0.548094 18.2755 0.339345 17.9543 0.203761 17.6007C0.0679202 17.2471 0 16.8888 0 16.5258C0 16.1627 0.0679202 15.8044 0.203761 15.4508C0.339345 15.0972 0.548094 14.776 0.830008 14.4873L3.96355 11.3358V6.88141C3.96355 6.07047 4.24559 5.3815 4.80967 4.81449C5.37401 4.24722 6.06101 3.96358 6.87068 3.96358H11.3181L14.4647 0.831303C14.7551 0.54895 15.0806 0.339875 15.4413 0.204078C15.8017 0.0680261 16.1632 0 16.5257 0C16.888 0 17.2451 0.0722542 17.5971 0.216762C17.9491 0.361269 18.2704 0.574699 18.561 0.857053L21.6819 3.96358H26.1293C26.939 3.96358 27.6269 4.24722 28.193 4.81449C28.7594 5.3815 29.0426 6.07047 29.0426 6.88141V11.3358L32.17 14.4873C32.4519 14.7781 32.6607 15.0998 32.7962 15.4523C32.9321 15.8049 33 16.1627 33 16.5258C33 16.8888 32.9321 17.2466 32.7962 17.5992C32.6607 17.9517 32.4519 18.2734 32.17 18.5642L29.0426 21.7157V26.1701C29.0426 26.981 28.7594 27.6691 28.193 28.2343C27.6269 28.7993 26.939 29.0818 26.1293 29.0818H21.6819L18.561 32.1687C18.2724 32.4382 17.9517 32.6441 17.5986 32.7863C17.2456 32.9288 16.888 33 16.5257 33C16.1632 33 15.8054 32.9288 15.4524 32.7863C15.0994 32.6441 14.7786 32.4382 14.49 32.1687L11.3181 29.0818Z" fill="url(#paint0_linear_732_11335)" /><path d="M11.1082 27.4317C11.655 27.4317 12.1809 27.6384 12.581 28.0092L12.6192 28.0457L15.6234 30.9692C15.7487 31.085 15.8766 31.1694 16.0102 31.2305L16.069 31.2558L16.0699 31.2562C16.2367 31.3235 16.3853 31.3501 16.5257 31.3501V33L16.4578 32.9992C16.1186 32.9908 15.7834 32.9199 15.4524 32.7864C15.0994 32.6442 14.7786 32.4382 14.49 32.1686L11.4684 29.2281C11.378 29.1402 11.2588 29.0885 11.1334 29.0824L11.1082 29.0818V27.4317ZM21.8942 29.0818L21.8688 29.0824C21.742 29.0886 21.6217 29.1414 21.531 29.2311L18.561 32.1686C18.2724 32.4382 17.9516 32.6442 17.5986 32.7864C17.2456 32.9288 16.8879 33 16.5257 33V31.3501C16.6657 31.3501 16.8143 31.3236 16.9812 31.2562L16.9822 31.2558C17.1359 31.1939 17.2816 31.1032 17.424 30.9723L20.3706 28.0579C20.7762 27.6567 21.3237 27.4317 21.8942 27.4317V29.0818ZM26.1294 27.4317V29.0818H21.8942V27.4317H26.1294ZM27.3926 26.1701V21.9285C27.3926 21.3568 27.6186 20.8082 28.0213 20.4024L30.9875 17.4132C31.1246 17.2712 31.2063 17.1366 31.2562 17.0069L31.2566 17.006C31.3226 16.8349 31.3501 16.6777 31.3501 16.5257C31.35 16.3737 31.3225 16.2166 31.2566 16.0456L31.2562 16.0446C31.2061 15.9142 31.1238 15.7786 30.9852 15.6357H30.9851L28.0213 12.649C27.6186 12.2432 27.3926 11.6946 27.3926 11.1229V6.88139C27.3926 6.50193 27.2788 6.23407 27.0256 5.98054L27.0252 5.98C26.7721 5.72646 26.5059 5.61355 26.1294 5.61354H21.8952C21.3223 5.61354 20.7728 5.38671 20.3668 4.98261L17.41 2.03938C17.2608 1.89472 17.1151 1.80245 16.9705 1.74309C16.8071 1.67602 16.6623 1.64995 16.5257 1.64995C16.3745 1.64995 16.21 1.6775 16.0239 1.74771L16.0226 1.74826C15.8855 1.79987 15.7518 1.88153 15.6161 2.01314L12.6334 4.98247C12.2273 5.38664 11.6777 5.61354 11.1048 5.61354H6.87065C6.49422 5.61355 6.23 5.72639 5.97946 5.97823C5.72773 6.23126 5.61354 6.49979 5.61354 6.88139V11.1227C5.61354 11.6951 5.38701 12.2443 4.98342 12.6502L2.00947 15.6412C1.87483 15.7794 1.79408 15.9117 1.74431 16.0415L1.74404 16.0426C1.67759 16.2156 1.64995 16.3737 1.64995 16.5257C1.64995 16.6588 1.67112 16.7965 1.72093 16.9448L1.74404 17.009L1.74431 17.0099C1.79408 17.1397 1.87485 17.272 2.00947 17.4102L4.98342 20.4012C5.38703 20.8071 5.61352 21.3563 5.61354 21.9287V26.1701C5.61355 26.5514 5.72736 26.8179 5.97701 27.0683L6.02406 27.1136C6.26059 27.3323 6.5157 27.4317 6.87065 27.4317V29.0818L6.79518 29.081C6.01822 29.0639 5.35636 28.7816 4.80964 28.2343C4.26321 27.6867 3.98148 27.0239 3.96441 26.2457L3.9636 26.1701V21.9287C3.96358 21.8008 3.91606 21.6778 3.83088 21.5832L3.81334 21.5646L0.830004 18.5643C0.54809 18.2755 0.339278 17.9543 0.203694 17.6007C0.0678556 17.2472 0 16.8888 0 16.5257C6.62113e-06 16.1627 0.0678695 15.8044 0.203694 15.4508C0.339278 15.0972 0.54809 14.776 0.830004 14.4873L3.81334 11.4869C3.90355 11.3962 3.95663 11.2754 3.96292 11.1482L3.9636 11.1227V6.88139C3.9636 6.09581 4.2282 5.42465 4.75757 4.86798L4.80964 4.81454C5.35636 4.26499 6.01822 3.98157 6.79518 3.96441L6.87065 3.9636H11.1048L11.1304 3.96292C11.2492 3.95704 11.3624 3.9104 11.4508 3.83075L11.4693 3.81307L14.4647 0.831364C14.7369 0.566643 15.04 0.366242 15.3741 0.230345L15.4413 0.204102C15.8017 0.0680505 16.1632 1.35067e-06 16.5257 0C16.8879 0 17.2451 0.0722463 17.5971 0.216747C17.9491 0.361255 18.2704 0.57471 18.561 0.857063L21.5307 3.8132C21.6215 3.90351 21.7423 3.95662 21.8696 3.96292L21.8952 3.9636H26.1294C26.939 3.9636 27.627 4.24728 28.1931 4.81454C28.7594 5.38154 29.0427 6.07049 29.0427 6.88139V11.1229C29.0427 11.2592 29.0965 11.39 29.1925 11.4868L32.17 14.4873C32.4519 14.7781 32.6607 15.0997 32.7963 15.4523C32.9321 15.8048 33 16.1627 33 16.5257L32.9992 16.5938C32.9912 16.9336 32.9237 17.2687 32.7963 17.5992C32.6607 17.9518 32.4519 18.2735 32.17 18.5643L29.1925 21.5647C29.0965 21.6615 29.0427 21.7922 29.0427 21.9285V26.1701L29.0417 26.2457C29.0246 27.0239 28.7417 27.6867 28.1931 28.2343L28.1396 28.2865C27.6017 28.7996 26.9568 29.0645 26.2048 29.081L26.1294 29.0818V27.4317C26.508 27.4317 26.775 27.3184 27.0275 27.0664C27.279 26.8153 27.3926 26.5495 27.3926 26.1701ZM11.1082 27.4317V29.0818H6.87065V27.4317H11.1082Z" fill="#735324" /><path d="M10.5911 23.6488C10.4271 24.362 11.2039 24.9198 11.8273 24.5365L16.0679 21.9288C16.3329 21.7658 16.6671 21.7658 16.9321 21.9288L21.1727 24.5365C21.7961 24.9198 22.5729 24.362 22.4089 23.6488L21.2782 18.7334C21.2102 18.4376 21.3101 18.1283 21.5383 17.9282L25.3477 14.5876C25.8956 14.1072 25.597 13.2042 24.8706 13.1451L19.8786 12.7389C19.5704 12.7139 19.3021 12.5185 19.1836 12.2329L17.262 7.60367C16.9804 6.9254 16.0196 6.9254 15.738 7.60367L13.8164 12.2329C13.6979 12.5185 13.4296 12.7139 13.1214 12.7389L8.12937 13.1451C7.40302 13.2042 7.10442 14.1072 7.65234 14.5876L11.4617 17.9282C11.6899 18.1283 11.7898 18.4376 11.7218 18.7334L10.5911 23.6488Z" fill="white" /><defs><linearGradient id="paint0_linear_732_11335" x1="29.9579" y1="30.9836" x2="4.87828" y2="1.96997" gradientUnits="userSpaceOnUse"><stop offset="0.41" stop-color="#C08A38" /><stop offset="0.9" stop-color="#735324" /></linearGradient></defs></svg><span>Premium</span></div>
                    <div class="tier__badge">2X as often in top search results
                        <input type="checkbox" id="gold">
                        <label for="gold"></label>
                        <div class="tooltip">
                            <div class="title">Premium</div>
                            <label for="gold" class="close"></label>
                            <div class="content">Premium Sponsored Jobs appear in the top three search results 2X more
                                often than Standard Sponsored Jobs. For hosted jobs only. Indeed data (US)</div>
                        </div>
                    </div>
                    <div class="tier__description">Get the highest level of visibility and appear more often in the top
                        3 search results. </div>
                    <div class="tier__features">
                        <div class="feature_title">Everything in Standard, and:</div>
                        <div class="feature_item dashed">
                            <input type="checkbox" id="first-page-boost">
                            <label for="first-page-boost">First page boost</label>
                            <div class="tooltip">
                                <div class="title">First page boost</div>
                                <label for="first-page-boost" class="close"></label>
                                <div class="content">Based on Indeed (US) data, Sponsored Jobs with a Premium plan
                                    appear in the top three search results 2X more often than Sponsored Jobs with a
                                    Standard plan.</div>
                            </div>
                        </div>
                        <div class="feature_item dashed">
                            <input type="checkbox" id="matched-candidates">
                            <label for="matched-candidates">Invite matched candidates</label>
                            <div class="tooltip">
                                <div class="title">Invite matched candidates</div>
                                <label for="matched-candidates" class="close"></label>
                                <div class="content">Contact top matches on the Jobs page and invite them to apply.
                                </div>
                            </div>
                        </div>
                        <div class="feature_item dashed">
                            <input type="checkbox" id="urgently-hiring-label">
                            <label for="urgently-hiring-label">Urgently hiring label</label>
                            <div class="tooltip">
                                <div class="title">Urgently hiring label</div>
                                <label for="urgently-hiring-label" class="close"></label>
                                <div class="content">Drive interested job seekers to apply right away by showing you're
                                    already actively reviewing candidates</div>
                            </div>
                        </div>
                        <div class="feature_item dashed">
                            <input type="checkbox" id="advance-matching">
                            <label for="advance-matching">Advanced matching</label>
                            <div class="tooltip">
                                <div class="title">Advanced matching</div>
                                <label for="advance-matching" class="close"></label>
                                <div class="content">Unlocks access to our latest AI-powered matching, allowing you to reach more qualified candidates who fit your job description and hiring needs.
                                    <br/><br/>Premium Sponsored Jobs posted directly on Indeed get 90% more quality applications than non-Premium Sponsored Jobs. (Indeed data, US)</div>
                            </div>
                        </div>
                        <div class="feature_item dashed">
                            <input type="checkbox" id="promote-your-brand">
                            <label for="promote-your-brand">Promote your brand</label>
                            <div class="tooltip">
                                <div class="title">Promote your brand</div>
                                <label for="promote-your-brand" class="close"></label>
                                <div class="content">Stand out from the crowd by adding your logo and a company image to
                                    your job post.</div>
                            </div>
                        </div>
                    </div>
                    <div class="tier__action">
                        <a href="${jobPostLink}">Post a job</a>
                    </div>
                </div>
            </div>
            <div class="tier__tnc">1. Terms, conditions, quality standards, and usage limits apply. Feature availability
                may vary by job and by market, and is subject to change at Indeed's discretion.</div>
            <div class="tier__how-pricing-works">How pricing works: Indeed provides a recommended budget based on the
                criteria you provided, such as job title, location, and job description.</div>
            <div class="tier__learn-more"><a href="#opt1399FAQ">Learn more</a></div>
        </div>
    </section>
    <section class="comparison">
        <div class="container">
            <div class="comparison__headline">Compare all features</div>
            <div class="table__head">
                <div></div>
                <div class="core">
                    <div>Free
                        <input type="checkbox" id="core1">
                        <label for="core1"><sup>1</sup></label>
                        <div class="tooltip">
                            <div class="title">1</div>
                            <label for="core1" class="close"></label>
                            <div class="content">Terms, conditions, quality standards, and usage limits apply. Feature
                                availability may vary by job and by market, and is subject to change at Indeed's
                                discretion.
                            </div>
                        </div>&nbsp;to post
                    </div>
                    <a href="${jobPostLink}">Post a job</a>
                </div>
                <div class="blue">
                    <div>Standard Sponsored Jobs</div>
                    <a href="${jobPostLink}">Post a job</a>
                </div>
                <div class="gold">
                    <div>Premium Sponsored Jobs</div>
                    <a href="${jobPostLink}">Post a job</a>
                </div>
            </div>
            <div class="table__body">
                <div class="table__title">Job post visibility</div>
                <div class="feature"><input type="checkbox" id="f1" /><label for="f1" class="feature__title">Visible in search results</label></div>
                <div class="core" aria-checked="true"></div>
                <div class="blue" aria-checked="true"></div>
                <div class="gold" aria-checked="true"></div>
                <div class="feature"><input type="checkbox" id="f2" /><label for="f2" class="feature__title">Visibility boost</label><div class="tooltip"><div class="title">Visibility boost</div><label for="f2" class="close"></label><div class="content">Prioritize your Sponsored Job over free<sup>1</sup> job posts in relevant search results, so it's seen by active job seekers.</div></div></div>
                <div class="core"></div>
                <div class="blue" aria-checked="true"></div>
                <div class="gold" aria-checked="true"></div>
                <div class="feature"><input type="checkbox" id="f3" /><label for="f3" class="feature__title">First page boost</label><div class="tooltip"><div class="title">First page boost</div><label for="f3" class="close"></label><div class="content">Based on Indeed (US) data, Sponsored Jobs with a Premium plan appear in the top three search results 2X more often than Sponsored Jobs with a Standard plan.</div></div></div>
                <div class="core"></div>
                <div class="blue"></div>
                <div class="gold" aria-checked="true"></div>
                <div class="feature"><input type="checkbox" id="f3_3" /><label for="f3_3" class="feature__title">Advanced matching</label><div class="tooltip"><div class="title">Advanced matching</div><label for="f3_3" class="close"></label><div class="content">Unlocks access to our latest AI-powered matching, allowing you to reach more qualified candidates who fit your job description and hiring needs.<br/><br/>Premium Sponsored Jobs posted directly on Indeed get 90% more quality applications than non-Premium Sponsored Jobs. (Indeed data, US)</div></div></div>
                <div class="core"></div>
                <div class="blue"></div>
                <div class="gold" aria-checked="true"></div>
            </div>
            <div class="table__body">
                <div class="table__title">Candidate outreach</div>
                <div class="feature"><input type="checkbox" id="f4" /><label for="f4" class="feature__title">Indeed Apply</label><div class="tooltip"><div class="title">Indeed Apply</div><label for="f4" class="close"></label><div class="content">Boost application completion and reduce candidate drop-offs by letting candidates apply to your ATS jobs directly on Indeed.</div></div></div>
                <div class="core" aria-checked="true"></div>
                <div class="blue" aria-checked="true"></div>
                <div class="gold" aria-checked="true"></div>
                <div class="feature"><input type="checkbox" id="f5" /><label for="f5" class="feature__title">Email advertising</label><div class="tooltip"><div class="title">Email advertising</div><label for="f5" class="close"></label><div class="content">Feature your Sponsored Job in email notifications sent to relevant job seekers in our database.</div></div></div>
                <div class="core"></div>
                <div class="blue" aria-checked="true"></div>
                <div class="gold" aria-checked="true"></div>
                <div class="feature"><input type="checkbox" id="f6" /><label for="f6" class="feature__title">Job seeker feed</label><div class="tooltip"><div class="title">Job seeker feed</div><label for="f6" class="close"></label><div class="content">Stand out on Indeed's homepage to job seekers who previously searched for jobs like yours.</div></div></div>
                <div class="core"></div>
                <div class="blue" aria-checked="true"></div>
                <div class="gold" aria-checked="true"></div>
                <div class="feature"><input type="checkbox" id="f7" /><label for="f7" class="feature__title">Matched candidates</label><div class="tooltip"><div class="title">Matched candidates</div><label for="f7" class="close"></label><div class="content">Contact top matches on the Jobs page and invite them to apply.</div></div></div>
                <div class="core"></div>
                <div class="blue"></div>
                <div class="gold" aria-checked="true"></div>
                <div class="feature"><input type="checkbox" id="f8" /><label for="f8" class="feature__title">Urgently hiring label</label><div class="tooltip"><div class="title">Urgently hiring label</div><label for="f8" class="close"></label><div class="content">Drive interested job seekers to apply right away by showing you're already actively reviewing candidates</div></div></div>
                <div class="core"></div>
                <div class="blue"></div>
                <div class="gold" aria-checked="true"></div>
                <div class="feature"><input type="checkbox" id="f9" /><label for="f9" class="feature__title">Promote your brand</label><div class="tooltip"><div class="title">Promote your brand</div><label for="f9" class="close"></label><div class="content">Stand out from the crowd by adding your logo and a company image to your job post.</div></div></div>
                <div class="core"></div>
                <div class="blue"></div>
                <div class="gold" aria-checked="true"></div>
            </div>
            <div class="table__body">
                <div class="table__title">Time-saving tools</div>
                <div class="feature"><input type="checkbox" id="f10" /><label for="f10" class="feature__title">Screening questions</label><div class="tooltip"><div class="title">Screening questions</div><label for="f10" class="close"></label><div class="content">Save time in your recruitment process by including qualifying questions in your job posting.</div></div></div>
                <div class="core" aria-checked="true"></div>
                <div class="blue" aria-checked="true"></div>
                <div class="gold" aria-checked="true"></div>
                <div class="feature"><input type="checkbox" id="f11" /><label for="f11" class="feature__title">Analytics</label><div class="tooltip"><div class="title">Analytics</div><label for="f11" class="close"></label><div class="content">Access reporting to measure job post performance across key metrics, like impressions, clicks, and applications.</div></div></div>
                <div class="core" aria-checked="true"></div>
                <div class="blue" aria-checked="true"></div>
                <div class="gold" aria-checked="true"></div>
                <div class="feature"><input type="checkbox" id="f12" /><label for="f12" class="feature__title">Bulk candidate export</label><div class="tooltip"><div class="title">Bulk candidate export</div><label for="f12" class="close"></label><div class="content">Download candidate details, such as contact information and notes you've taken.</div></div></div>
                <div class="core" aria-checked="true"></div>
                <div class="blue" aria-checked="true"></div>
                <div class="gold" aria-checked="true"></div>
                <div class="feature"><input type="checkbox" id="f13" /><label for="f13" class="feature__title">Message templates</label><div class="tooltip"><div class="title">Message templates</div><label for="f13" class="close"></label><div class="content">Schedule interviews using templated messages to contact candidates at scale.</div></div></div>
                <div class="core" aria-checked="true"></div>
                <div class="blue" aria-checked="true"></div>
                <div class="gold" aria-checked="true"></div>
                <div class="feature"><input type="checkbox" id="f14" /><label for="f14" class="feature__title">Automated messages</label><div class="tooltip"><div class="title">Automated messages</div><label for="f14" class="close"></label><div class="content">Connect with candidates when they apply to your job, are added to your shortlist, or you reject an application from the employer dashboard.</div></div></div>
                <div class="core"></div>
                <div class="blue" aria-checked="true"></div>
                <div class="gold" aria-checked="true"></div>
                <div class="feature"><input type="checkbox" id="f15" /><label for="f15" class="feature__title">SMS messages</label><div class="tooltip"><div class="title">SMS messages</div><label for="f15" class="close"></label><div class="content">Your messages get delivered by text to candidates who have SMS messaging turned on.</div></div></div>
                <div class="core"></div>
                <div class="blue"></div>
                <div class="gold" aria-checked="true"></div>
            </div>
            <div class="comparison__tnc">1. Terms, conditions, quality standards, and usage limits apply. Feature availability may vary by job and by market, and is subject to change at Indeed's discretion.</div>
            <div class="comparison__action"><button class="collapse-feature"> all features</button></div>
        </div>
    </section>
    <section class="m_comparison">
        <div class="container">
            <div class="m_comparison__title">Compare all features</div>
            <div class="m_comparison__cards">
                <div class="core"><div class="m_comparison__pin"></div><h2>Free <input type="checkbox" id="core2"><label for="core2"><sup>1</sup></label><div class="tooltip"><div class="title">1</div><label for="core2" class="close"></label><div class="content">Terms, conditions, quality standards, and usage limits apply. Feature availability may vary by job and by market, and is subject to change at Indeed's discretion.</div></div> to post</h2><div class="m_comparison__badge"></div><div class="m_comparison__item"><div class="feature__title">Indeed Apply</div><div class="feature__description">Boost application completion and reduce candidate drop-offs by letting candidates apply to your ATS jobs directly on Indeed.</div></div><div class="m_comparison__item"><div class="feature__title">Screening questions</div><div class="feature__description">Save time in your recruitment process by including qualifying questions in your job posting.</div></div><div class="m_comparison__item"><div class="feature__title">Analytics</div><div class="feature__description">Access reporting to measure job post performance across key metrics, like impressions, clicks, and applications.</div></div><div class="m_comparison__item"><div class="feature__title">Bulk candidate export</div><div class="feature__description">Download candidate details, such as contact information and notes you've taken.</div></div><div class="m_comparison__item"><div class="feature__title">Message templates</div><div class="feature__description">Schedule interviews using templated messages to contact candidates at scale.</div></div><div class="m_comparison__action"><a href="${jobPostLink}">Post a job</a></div></div>
                <div class="blue"><div class="m_comparison__pin">Popular</div><h2>Standard Sponsored Jobs</h2><div class="m_comparison__badge">The features of posting a free <input type="checkbox" id="core3"><label for="core3"><sup>1</sup></label><div class="tooltip"><div class="title">1</div><label for="core3" class="close"></label><div class="content">Terms, conditions, quality standards, and usage limits apply. Feature availability may vary by job and by market, and is subject to change at Indeed's discretion.</div></div> job, plus:</div><div class="m_comparison__item"><div class="feature__title">Visibility boost</div><div class="feature__description">Prioritize your Sponsored Job over free1 job posts in relevant search results, so it's seen by active job seekers.</div></div><div class="m_comparison__item"><div class="feature__title">Email advertising</div><div class="feature__description">Feature your Sponsored Job in email notifications sent to relevant job seekers in our database.</div></div><div class="m_comparison__item"><div class="feature__title">Job seeker feed</div><div class="feature__description">Stand out on Indeed's homepage to job seekers who previously searched for jobs like yours.</div></div><div class="m_comparison__item"><div class="feature__title">Automated messages</div><div class="feature__description">Connect with candidates when they apply to your job, are added to your shortlist, or you reject an application from the employer dashboard.</div></div><div class="m_comparison__action"><a href="${jobPostLink}">Post a job</a></div></div>
                <div class="gold"><div class="m_comparison__pin"></div><h2>Premium Sponsored Jobs</h2><div class="m_comparison__badge">The features of Standard Sponsored Jobs, plus:</div><div class="m_comparison__item"><div class="feature__title">First page boost</div><div class="feature__description">Based on Indeed (US) data, Sponsored Jobs with a Premium plan appear in the top three search results 2X more often than Sponsored Jobs with a Standard plan.</div></div><div class="m_comparison__item"><div class="feature__title">Advanced matching</div><div class="feature__description">Unlocks access to our latest AI-powered matching, allowing you to reach more qualified candidates who fit your job description and hiring needs.<br/><br/>Premium Sponsored Jobs posted directly on Indeed get 90% more quality applications than non-Premium Sponsored Jobs. (Indeed data, US)</div></div><div class="m_comparison__item"><div class="feature__title">Matched candidates</div><div class="feature__description">Contact top matches on the Jobs page and invite them to apply.</div></div><div class="m_comparison__item"><div class="feature__title">Urgently hiring label</div><div class="feature__description">Drive interested job seekers to apply right away by showing you're already actively reviewing candidates</div></div><div class="m_comparison__item"><div class="feature__title">Promote your brand</div><div class="feature__description">Stand out from the crowd by adding your logo and a company image to your job post.</div></div><div class="m_comparison__item"><div class="feature__title">SMS messages</div><div class="feature__description">Your messages get delivered by text to candidates who have SMS messaging turned on.</div></div><div class="m_comparison__action"><a href="${jobPostLink}">Post a job</a></div></div>
            </div>
        </div>
    </section>
</div>`;

const change1Html = _1445_contents + _1399_contents;

const outPath = path.join(__dirname, 'change-1-insert-html.html');
fs.writeFileSync(outPath, change1Html);
console.log(`wrote ${outPath} (${change1Html.length} bytes, ~${Math.round(change1Html.length / 1024)} KB)`);
